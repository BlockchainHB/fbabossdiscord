import { OpenAIService, ChatCompletionResponse } from './openai';
import { PineconeService, PineconeMatch } from './pinecone';
import { DiscordDatabaseService } from './discord-database';
import { NamespaceRouter } from './namespace-router';
import { supabase } from '../config/database';
import { MEMORY_MESSAGE_LIMIT } from '../config/discord';
import logger from '../utils/logger';

export interface QARequest {
  question: string;
  userId: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
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
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        attempt++;
        logger.info(`Processing question from user ${request.userId} (attempt ${attempt}/${maxRetries}): ${request.question}`);

        // Step 1: Improve question quality with retry logic
        const improvedQuestion = await this.improveQuestionWithRetry(request.question);
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
          minScore: 0.02,
          namespaces: routing.namespaces
        });

        logger.debug(`Found ${searchResults.length} relevant documents`);

        // Step 5: Get conversation context if enabled
        let conversationContext = '';
        let conversationId: string | undefined = undefined;
        
        if (request.contextMemory && request.guildId) {
          const context = await this.getConversationContext(
            request.userId, 
            request.guildId, 
            request.channelId,
            request.threadId
          );
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
        logger.error(`Error processing question (attempt ${attempt}/${maxRetries}):`, error);
        
        if (attempt === maxRetries) {
          // Final attempt failed, throw the error
          throw new Error(`Failed to process question after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Wait before retrying (exponential backoff)
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        logger.info(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Unexpected end of retry loop');
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

  private async improveQuestionWithRetry(question: string, maxRetries: number = 2): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const improvement = await this.openai.improveQuestion(question);
        return improvement.content || question;
      } catch (error) {
        logger.warn(`Failed to improve question (attempt ${attempt}/${maxRetries}):`, error);
        
        if (attempt === maxRetries) {
          logger.warn('All attempts to improve question failed, using original');
          return question;
        }
        
        // Short delay before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    return question;
  }

  private async getConversationContext(
    userId: string,
    guildId: string,
    channelId?: string,
    threadId?: string
  ): Promise<{ context: string; conversationId?: string }> {
    try {
      const discordUser = await this.dbService.getUser(userId);
      if (!discordUser) {
        return { context: '' };
      }

      // Look for thread-specific conversation first if threadId is provided
      let conversations;
      if (threadId) {
        conversations = await this.dbService.getThreadConversations(userId, guildId, threadId);
      } else {
        conversations = await this.dbService.getUserConversations(userId, guildId);
      }
      
      if (conversations.length === 0) {
        return { context: '' };
      }

      const recentConversation = conversations[0];
      if (!recentConversation) {
        return { context: '' };
      }
      
      // Get recent messages from the conversation with enhanced limit
      const { data: messages } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', recentConversation.conversation_id)
        .order('created_at', { ascending: false })
        .limit(MEMORY_MESSAGE_LIMIT);

      if (!messages || messages.length === 0) {
        return { context: '', conversationId: recentConversation.conversation_id };
      }

      // Format context from recent messages with intelligent summarization
      const contextMessages = messages
        .reverse()
        .map((msg, index) => {
          // Add timestamps for better context understanding
          const timeAgo = this.getTimeAgo(new Date(msg.created_at));
          return `${msg.role} (${timeAgo}): ${msg.content}`;
        })
        .join('\n\n');

      logger.debug(`Retrieved ${messages.length} messages for conversation context (limit: ${MEMORY_MESSAGE_LIMIT})`);

      return {
        context: contextMessages,
        conversationId: recentConversation.conversation_id
      };
    } catch (error) {
      logger.error('Error getting conversation context:', error);
      return { context: '' };
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
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
          thread_id: request.threadId || undefined,
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