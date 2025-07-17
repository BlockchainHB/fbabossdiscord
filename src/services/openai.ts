import OpenAI from 'openai';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface EmbeddingResponse {
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  object: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionResponse {
  content: string;
  finishReason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIService {
  private client: OpenAI;
  private embeddingModel: string;
  private chatModel: string;

  constructor() {
    const apiKey = process.env.OPENAI_API || process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('Missing OpenAI API key. Please check your .env file.');
    }

    this.client = new OpenAI({
      apiKey: apiKey
    });

    this.embeddingModel = 'text-embedding-ada-002';
    this.chatModel = 'gpt-3.5-turbo';
    
    logger.info('OpenAI service initialized');
  }

  async createEmbedding(
    text: string,
    options: {
      model?: string;
      user?: string;
    } = {}
  ): Promise<number[]> {
    try {
      const { model = this.embeddingModel, user } = options;
      
      const response = await this.client.embeddings.create({
        model,
        input: text,
        ...(user && { user })
      });

      if (response.data && response.data.length > 0 && response.data[0]) {
        return response.data[0].embedding;
      }

      throw new Error('No embedding data returned from OpenAI');
    } catch (error) {
      logger.error('Error creating embedding:', error);
      throw error;
    }
  }

  async createEmbeddings(
    texts: string[],
    options: {
      model?: string;
      user?: string;
    } = {}
  ): Promise<number[][]> {
    try {
      const { model = this.embeddingModel, user } = options;
      
      const response = await this.client.embeddings.create({
        model,
        input: texts,
        ...(user && { user })
      });

      if (response.data && response.data.length > 0) {
        return response.data
          .sort((a, b) => a.index - b.index)
          .map(item => item.embedding);
      }

      throw new Error('No embedding data returned from OpenAI');
    } catch (error) {
      logger.error('Error creating embeddings:', error);
      throw error;
    }
  }

  async createChatCompletion(
    messages: ChatMessage[],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      user?: string;
    } = {}
  ): Promise<ChatCompletionResponse> {
    try {
      const {
        model = this.chatModel,
        temperature = 0.7,
        maxTokens = 1000,
        stream = false,
        user
      } = options;

      const response = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false, // Force stream to false to get proper response type
        ...(user && { user })
      });

      // Type guard to ensure we have a non-streaming response
      if ('choices' in response && response.choices) {
        const choice = response.choices[0];
        
        if (!choice?.message?.content) {
          throw new Error('No content returned from OpenAI');
        }

        return {
          content: choice.message.content,
          finishReason: choice.finish_reason || 'unknown',
          usage: {
            prompt_tokens: response.usage?.prompt_tokens || 0,
            completion_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0
          }
        };
      } else {
        throw new Error('Unexpected response type from OpenAI');
      }
    } catch (error) {
      logger.error('Error creating chat completion:', error);
      throw error;
    }
  }

  async generateAnswer(
    question: string,
    context: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      user?: string;
    } = {}
  ): Promise<ChatCompletionResponse> {
    try {
      const {
        model = this.chatModel,
        temperature = 0.7,
        maxTokens = 800,
        systemPrompt,
        user
      } = options;

      const defaultSystemPrompt = `You are an expert FBA (Fulfillment by Amazon) course assistant. You help students understand Amazon FBA concepts, strategies, and best practices.

Instructions:
- Provide accurate, helpful answers based on the provided context
- Focus on practical, actionable advice
- Use clear, concise language
- If the context doesn't contain enough information, say so honestly
- Always maintain a professional, helpful tone
- Structure your response with clear sections when appropriate

Context from FBA course materials:
${context}`;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt || defaultSystemPrompt
        },
        {
          role: 'user',
          content: question
        }
      ];

      return await this.createChatCompletion(messages, {
        model,
        temperature,
        maxTokens,
        ...(user && { user })
      });
    } catch (error) {
      logger.error('Error generating answer:', error);
      throw error;
    }
  }

  async summarizeContent(
    content: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      type?: 'brief' | 'detailed';
      user?: string;
    } = {}
  ): Promise<ChatCompletionResponse> {
    try {
      const {
        model = this.chatModel,
        temperature = 0.3,
        maxTokens = 300,
        type = 'brief',
        user
      } = options;

      const systemPrompt = type === 'brief' 
        ? 'You are a helpful assistant that creates brief, concise summaries of FBA course content. Focus on key points and actionable insights.'
        : 'You are a helpful assistant that creates detailed summaries of FBA course content. Include key concepts, strategies, and practical examples.';

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Please summarize the following FBA course content:\n\n${content}`
        }
      ];

      return await this.createChatCompletion(messages, {
        model,
        temperature,
        maxTokens,
        ...(user && { user })
      });
    } catch (error) {
      logger.error('Error summarizing content:', error);
      throw error;
    }
  }

  async improveQuestion(
    question: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      user?: string;
    } = {}
  ): Promise<ChatCompletionResponse> {
    try {
      const {
        model = this.chatModel,
        temperature = 0.5,
        maxTokens = 200,
        user
      } = options;

      const systemPrompt = `You are an expert at improving questions to get better answers from an FBA course knowledge base. 

Your task is to:
1. Clarify vague questions
2. Add context when helpful
3. Break down complex questions into focused parts
4. Ensure questions are specific to Amazon FBA topics

Return only the improved question, nothing else.`;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Improve this question for better FBA course search results: "${question}"`
        }
      ];

      return await this.createChatCompletion(messages, {
        model,
        temperature,
        maxTokens,
        ...(user && { user })
      });
    } catch (error) {
      logger.error('Error improving question:', error);
      throw error;
    }
  }

  async validateAnswer(
    question: string,
    answer: string,
    context: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      user?: string;
    } = {}
  ): Promise<{
    isValid: boolean;
    confidence: number;
    feedback: string;
  }> {
    try {
      const {
        model = this.chatModel,
        temperature = 0.3,
        maxTokens = 300,
        user
      } = options;

      const systemPrompt = `You are an expert validator for FBA course answers. Your task is to evaluate if an answer is accurate, helpful, and well-supported by the provided context.

Return your evaluation in this exact JSON format:
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "feedback": "Brief explanation of your evaluation"
}`;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Question: ${question}\n\nAnswer: ${answer}\n\nContext: ${context}\n\nPlease evaluate this answer.`
        }
      ];

      const response = await this.createChatCompletion(messages, {
        model,
        temperature,
        maxTokens,
        user
      });

      try {
        const evaluation = JSON.parse(response.content);
        return {
          isValid: evaluation.isValid || false,
          confidence: evaluation.confidence || 0,
          feedback: evaluation.feedback || 'No feedback provided'
        };
      } catch (parseError) {
        logger.warn('Failed to parse validation response, using default');
        return {
          isValid: true,
          confidence: 0.5,
          feedback: 'Validation parsing failed'
        };
      }
    } catch (error) {
      logger.error('Error validating answer:', error);
      return {
        isValid: true,
        confidence: 0.5,
        feedback: 'Validation failed'
      };
    }
  }

  // Helper method to estimate token count (rough approximation)
  estimateTokenCount(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }

  // Helper method to truncate text to fit within token limits
  truncateToTokenLimit(text: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokenCount(text);
    
    if (estimatedTokens <= maxTokens) {
      return text;
    }

    const maxChars = maxTokens * 4;
    return text.substring(0, maxChars - 10) + '...';
  }
}