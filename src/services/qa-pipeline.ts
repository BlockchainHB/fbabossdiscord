import { OpenAIService, ChatCompletionResponse } from './openai';
import { PineconeService, PineconeMatch } from './pinecone';
import { DiscordDatabaseService } from './discord-database';
import { NamespaceRouter } from './namespace-router';
import { supabase } from '../config/database';
import logger from '../utils/logger';

export interface QARequest {
  question: string;
  userId: string;
  guildId?: string;
  channelId?: string;
  contextMemory?: boolean;
  language?: string;
  customSystemPrompt?: string;
}

export interface QAResponse {
  answer: string;
  confidence: number;
  sources: Array<{
    title: string;
    content: string;
    score: number;
    metadata: {
      module_id?: string;
      lesson_id?: string;
      title?: string;
      topics?: string[];
      timestamp?: string;
      [key: string]: any;
    };
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    embeddingTokens: number;
  };
  processingTime: number;
  conversationId?: string;
}

export class QAPipelineService {
  private openai: OpenAIService;
  private pinecone: PineconeService;
  private dbService: DiscordDatabaseService;
  private router: NamespaceRouter;

  constructor() {
    this.openai = new OpenAIService();
    this.pinecone = new PineconeService();
    this.dbService = new DiscordDatabaseService();
    this.router = new NamespaceRouter();
  }

  async processQuestion(request: QARequest): Promise<QAResponse> {
    const startTime = Date.now();
    let embeddingTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      logger.info(`Processing question from user ${request.userId}: ${request.question}`);

      // Step 1: Improve question quality
      const improvedQuestion = await this.improveQuestion(request.question);
      logger.debug(`Improved question: ${improvedQuestion}`);

      // Step 2: Route question to relevant namespaces
      const routing = await this.router.routeQuestion(improvedQuestion);
      logger.debug(`Routed to namespaces: ${routing.namespaces.join(', ')}`);
      logger.debug(`Routing confidence: ${routing.confidence}`);

      // Step 3: Create embedding for the question
      const questionEmbedding = await this.openai.createEmbedding(improvedQuestion);
      embeddingTokens += this.openai.estimateTokenCount(improvedQuestion);

      // Step 4: Search for relevant content in Pinecone using routed namespaces
      const searchResults = await this.pinecone.searchSimilar(questionEmbedding, {
        topK: 5,
        minScore: 0.02, // Lowered threshold based on actual score ranges
        namespaces: routing.namespaces
        // Removed contentTypes filter as metadata doesn't contain this field
      });

      logger.debug(`Found ${searchResults.length} relevant documents`);

      // Step 5: Get conversation context if enabled
      let conversationContext = '';
      let conversationId: string | undefined = undefined;
      
      if (request.contextMemory && request.guildId) {
        const context = await this.getConversationContext(request.userId, request.guildId);
        conversationContext = context.context;
        conversationId = context.conversationId;
      }

      // Step 6: Prepare context from search results
      const documentContext = this.prepareDocumentContext(searchResults);

      // Step 7: Generate answer using OpenAI
      const answerResponse = await this.generateAnswer(
        request.question,
        documentContext,
        conversationContext,
        {
          language: request.language || 'en',
          customSystemPrompt: request.customSystemPrompt || undefined
        }
      );

      promptTokens += answerResponse.usage.prompt_tokens;
      completionTokens += answerResponse.usage.completion_tokens;

      // Step 8: Validate answer quality
      const validation = await this.openai.validateAnswer(
        request.question,
        answerResponse.content,
        documentContext
      );

      // Step 9: Store conversation if context memory is enabled
      if (request.contextMemory && request.guildId && request.channelId) {
        await this.storeConversation(
          request,
          answerResponse.content,
          conversationId || undefined
        );
      }

      // Step 10: Log usage for analytics
      await this.logUsage(request, {
        promptTokens,
        completionTokens,
        embeddingTokens,
        processingTime: Date.now() - startTime,
        resultsCount: searchResults.length,
        confidence: validation.confidence
      });

      const processingTime = Date.now() - startTime;

      return {
        answer: answerResponse.content,
        confidence: validation.confidence,
        sources: searchResults.map(result => ({
          title: result.metadata.title || 'Untitled',
          content: result.metadata.description || result.metadata.text || '',
          score: result.score,
          metadata: result.metadata
        })),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          embeddingTokens
        },
        processingTime,
        conversationId
      };

    } catch (error) {
      logger.error('Error processing question:', error);
      throw error;
    }
  }

  private async improveQuestion(question: string): Promise<string> {
    try {
      const improvement = await this.openai.improveQuestion(question);
      return improvement.content || question;
    } catch (error) {
      logger.warn('Failed to improve question, using original:', error);
      return question;
    }
  }

  private async getConversationContext(
    userId: string,
    guildId: string
  ): Promise<{ context: string; conversationId?: string }> {
    try {
      const discordUser = await this.dbService.getUser(userId);
      if (!discordUser) {
        return { context: '' };
      }

      const conversations = await this.dbService.getUserConversations(userId, guildId);
      
      if (conversations.length === 0) {
        return { context: '' };
      }

      const recentConversation = conversations[0];
      if (!recentConversation) {
        return { context: '' };
      }
      
      // Get recent messages from the conversation
      const { data: messages } = await supabase
        .from('messages')
        .select('role, content')
        .eq('conversation_id', recentConversation.conversation_id)
        .order('created_at', { ascending: false })
        .limit(6);

      if (!messages || messages.length === 0) {
        return { context: '', conversationId: recentConversation.conversation_id };
      }

      // Format context from recent messages
      const contextMessages = messages
        .reverse()
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

      return {
        context: contextMessages,
        conversationId: recentConversation.conversation_id
      };
    } catch (error) {
      logger.error('Error getting conversation context:', error);
      return { context: '' };
    }
  }

  private prepareDocumentContext(searchResults: PineconeMatch[]): string {
    if (searchResults.length === 0) {
      return 'No relevant course content found.';
    }

    return searchResults.map((result, index) => {
      const metadata = result.metadata;
      const title = metadata.title || `Source ${index + 1}`;
      const content = metadata.text || metadata.description || '';
      const score = (result.score * 100).toFixed(1);
      
      return `[${title}] (Relevance: ${score}%)\n${content}`;
    }).join('\n\n');
  }

  private async generateAnswer(
    question: string,
    documentContext: string,
    conversationContext: string,
    options: {
      language?: string;
      customSystemPrompt?: string;
    } = {}
  ): Promise<ChatCompletionResponse> {
    const { language = 'en', customSystemPrompt } = options;

    let systemPrompt = customSystemPrompt || `You are an expert FBA (Fulfillment by Amazon) course assistant. You help students understand Amazon FBA concepts, strategies, and best practices.

Instructions:
- Provide accurate, helpful answers based on the provided context
- Focus on practical, actionable advice
- Use clear, concise language appropriate for ${language === 'en' ? 'English' : language} speakers
- If the context doesn't contain enough information, say so honestly
- Always maintain a professional, helpful tone
- Structure your response with clear sections when appropriate
- Reference specific sources when possible

${conversationContext ? `Recent conversation context:\n${conversationContext}\n\n` : ''}

Context from FBA course materials:
${documentContext}`;

    return await this.openai.createChatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ], {
      temperature: 0.7,
      maxTokens: 800
    });
  }

  private async storeConversation(
    request: QARequest,
    answer: string,
    existingConversationId?: string
  ): Promise<void> {
    try {
      let conversationId = existingConversationId;

      // Create or use existing conversation
      if (!conversationId) {
        // Get or create auth user link
        const authUserId = await this.dbService.getOrCreateAuthUser(request.userId, 'discord_user');

        // Create new conversation
        const { data: conversation } = await supabase
          .from('conversations')
          .insert({
            user_id: authUserId,
            title: request.question.substring(0, 100)
          })
          .select()
          .single();

        if (!conversation) {
          logger.error('Failed to create conversation');
          return;
        }

        conversationId = conversation.id;

        // Create Discord conversation link
        await this.dbService.createDiscordConversation({
          conversation_id: conversationId!,
          guild_id: request.guildId!,
          channel_id: request.channelId!,
          discord_user_id: request.userId
        });
      }

      // Store user message
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content: request.question
        });

      // Store assistant response
      await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: answer
        });

    } catch (error) {
      logger.error('Error storing conversation:', error);
    }
  }

  private async logUsage(
    request: QARequest,
    metrics: {
      promptTokens: number;
      completionTokens: number;
      embeddingTokens: number;
      processingTime: number;
      resultsCount: number;
      confidence: number;
    }
  ): Promise<void> {
    try {
      const authUserId = await this.dbService.getOrCreateAuthUser(request.userId, 'discord_user');

      await supabase
        .from('usage_logs')
        .insert({
          user_id: authUserId,
          question_text: request.question,
          response_time_ms: metrics.processingTime,
          tokens_used: metrics.promptTokens + metrics.completionTokens,
          pinecone_results: {
            resultsCount: metrics.resultsCount,
            confidence: metrics.confidence,
            embeddingTokens: metrics.embeddingTokens
          }
        });

    } catch (error) {
      logger.error('Error logging usage:', error);
    }
  }

  // Helper method to get pipeline health status
  async getHealthStatus(): Promise<{
    openai: boolean;
    pinecone: boolean;
    database: boolean;
    overall: boolean;
  }> {
    const status = {
      openai: false,
      pinecone: false,
      database: false,
      overall: false
    };

    try {
      // Test OpenAI
      await this.openai.createEmbedding('health check');
      status.openai = true;
    } catch (error) {
      logger.error('OpenAI health check failed:', error);
    }

    try {
      // Test Pinecone
      await this.pinecone.getIndexStats();
      status.pinecone = true;
    } catch (error) {
      logger.error('Pinecone health check failed:', error);
    }

    try {
      // Test Database
      const { data } = await supabase.from('discord_guilds').select('id').limit(1);
      status.database = data !== null;
    } catch (error) {
      logger.error('Database health check failed:', error);
    }

    status.overall = status.openai && status.pinecone && status.database;
    return status;
  }
}