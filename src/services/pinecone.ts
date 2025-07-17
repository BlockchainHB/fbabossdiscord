import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

export interface PineconeMatch {
  id: string;
  score: number;
  metadata: {
    course_id?: string;
    module_id?: string;
    lesson_id?: string;
    content_type?: 'video' | 'text' | 'quiz' | 'assignment';
    title?: string;
    description?: string;
    duration?: number;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    topics?: string[];
    created_at?: string;
    updated_at?: string;
    timestamp?: string; // For video content with time markers
    [key: string]: any;
  };
}

export interface PineconeQueryResult {
  matches: PineconeMatch[];
  namespace?: string;
}

export class PineconeService {
  private client: Pinecone;
  private indexName: string;
  private index: any;

  constructor() {
    const apiKey = process.env.PINECONEO_API || process.env.PINECONE_API_KEY;
    this.indexName = process.env.PINECONE_INDEX_NAME || 'fba-course-openai';

    if (!apiKey) {
      throw new Error('Missing Pinecone API key. Please check your .env file.');
    }

    this.client = new Pinecone({
      apiKey: apiKey
    });

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      this.index = this.client.index(this.indexName);
      logger.info(`Pinecone service initialized with index: ${this.indexName}`);
    } catch (error) {
      logger.error('Failed to initialize Pinecone service:', error);
      throw error;
    }
  }

  async query(
    vector: number[],
    options: {
      topK?: number;
      namespace?: string;
      filter?: Record<string, any>;
      includeMetadata?: boolean;
      includeValues?: boolean;
    } = {}
  ): Promise<PineconeQueryResult> {
    try {
      const {
        topK = 5,
        namespace = '',
        filter,
        includeMetadata = true,
        includeValues = false
      } = options;

      const queryRequest = {
        vector,
        topK,
        includeMetadata,
        includeValues,
        ...(filter && { filter })
      };

      // Use namespace() method instead of namespace parameter
      const indexToQuery = namespace ? this.index.namespace(namespace) : this.index;
      const queryResponse = await indexToQuery.query(queryRequest);

      return {
        matches: queryResponse.matches || [],
        namespace: namespace || 'default'
      };
    } catch (error) {
      logger.error('Error querying Pinecone:', error);
      throw error;
    }
  }

  async searchSimilar(
    vector: number[],
    options: {
      topK?: number;
      namespace?: string;
      namespaces?: string[];
      minScore?: number;
      contentTypes?: string[];
      courseIds?: string[];
      topics?: string[];
    } = {}
  ): Promise<PineconeMatch[]> {
    try {
      const {
        topK = 5,
        namespace,
        namespaces,
        minScore = 0.02,
        contentTypes,
        courseIds,
        topics
      } = options;

      // Build filter object
      const filter: Record<string, any> = {};
      
      if (contentTypes && contentTypes.length > 0) {
        filter.content_type = { $in: contentTypes };
      }
      
      if (courseIds && courseIds.length > 0) {
        filter.course_id = { $in: courseIds };
      }
      
      if (topics && topics.length > 0) {
        filter.topics = { $in: topics };
      }

      // Determine namespaces to search based on parameters
      let namespacesToSearch: string[];
      
      if (namespaces && namespaces.length > 0) {
        // Use provided namespaces from router
        namespacesToSearch = namespaces;
      } else if (namespace) {
        // Use single namespace if provided
        namespacesToSearch = [namespace];
      } else {
        // Fallback to all unit namespaces (legacy behavior)
        namespacesToSearch = [
          'unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 
          'unit-6', 'unit-7', 'unit-8', 'unit-9'
        ];
      }

      // Search each namespace in parallel for better performance
      const namespaceQueries = namespacesToSearch.map(async (ns) => {
        try {
          const queryOptions: any = {
            topK,
            includeMetadata: true
          };
          
          if (Object.keys(filter).length > 0) {
            queryOptions.filter = filter;
          }
          
          const result = await this.query(vector, { ...queryOptions, namespace: ns });
          
          // Add namespace info to matches
          const namespacedMatches = result.matches.map(match => ({
            ...match,
            metadata: {
              ...match.metadata,
              namespace: ns
            }
          }));
          
          return namespacedMatches;
        } catch (error) {
          logger.warn(`Error querying namespace ${ns}:`, error);
          return []; // Return empty array for failed queries
        }
      });

      // Wait for all namespace queries to complete
      const namespaceResults = await Promise.all(namespaceQueries);
      
      // Flatten results from all namespaces
      const allMatches: PineconeMatch[] = namespaceResults.flat();

      // Sort by score and take top results
      allMatches.sort((a, b) => b.score - a.score);
      const topMatches = allMatches.slice(0, topK);

      // Filter by minimum score
      return topMatches.filter(match => match.score >= minScore);
    } catch (error) {
      logger.error('Error searching similar content:', error);
      throw error;
    }
  }

  async searchByText(
    queryText: string,
    embeddingVector: number[],
    options: {
      topK?: number;
      namespace?: string;
      minScore?: number;
      contentTypes?: string[];
      courseIds?: string[];
      topics?: string[];
    } = {}
  ): Promise<{
    matches: PineconeMatch[];
    queryText: string;
    totalMatches: number;
  }> {
    try {
      const matches = await this.searchSimilar(embeddingVector, options);
      
      return {
        matches,
        queryText,
        totalMatches: matches.length
      };
    } catch (error) {
      logger.error('Error searching by text:', error);
      throw error;
    }
  }

  async upsert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, any>;
    }>,
    namespace: string = ''
  ): Promise<void> {
    try {
      const upsertRequest = {
        vectors,
        ...(namespace && { namespace })
      };

      await this.index.upsert(upsertRequest);
      logger.info(`Upserted ${vectors.length} vectors to Pinecone`);
    } catch (error) {
      logger.error('Error upserting vectors:', error);
      throw error;
    }
  }

  async delete(
    ids: string[],
    namespace: string = ''
  ): Promise<void> {
    try {
      const deleteRequest = {
        ids,
        ...(namespace && { namespace })
      };

      await this.index.delete(deleteRequest);
      logger.info(`Deleted ${ids.length} vectors from Pinecone`);
    } catch (error) {
      logger.error('Error deleting vectors:', error);
      throw error;
    }
  }

  async deleteAll(namespace: string = ''): Promise<void> {
    try {
      const deleteRequest = {
        deleteAll: true,
        ...(namespace && { namespace })
      };

      await this.index.delete(deleteRequest);
      logger.info(`Deleted all vectors from namespace: ${namespace || 'default'}`);
    } catch (error) {
      logger.error('Error deleting all vectors:', error);
      throw error;
    }
  }

  async fetch(
    ids: string[],
    namespace: string = ''
  ): Promise<{
    vectors: Record<string, {
      id: string;
      values?: number[];
      metadata?: Record<string, any>;
    }>;
    namespace: string;
  }> {
    try {
      const fetchRequest = {
        ids,
        ...(namespace && { namespace })
      };

      const response = await this.index.fetch(fetchRequest);
      
      return {
        vectors: response.vectors || {},
        namespace: response.namespace || ''
      };
    } catch (error) {
      logger.error('Error fetching vectors:', error);
      throw error;
    }
  }

  async getIndexStats(namespace: string = ''): Promise<{
    totalVectorCount: number;
    dimension: number;
    indexFullness: number;
    namespaces: Record<string, { vectorCount: number }>;
  }> {
    try {
      const statsRequest = namespace ? { filter: { namespace } } : {};
      const stats = await this.index.describeIndexStats(statsRequest);
      
      return {
        totalVectorCount: stats.totalVectorCount || 0,
        dimension: stats.dimension || 0,
        indexFullness: stats.indexFullness || 0,
        namespaces: stats.namespaces || {}
      };
    } catch (error) {
      logger.error('Error getting index stats:', error);
      throw error;
    }
  }

  // Helper method to format search results for display
  formatSearchResults(matches: PineconeMatch[]): string {
    if (matches.length === 0) {
      return 'No relevant content found in the knowledge base.';
    }

    return matches.map((match, index) => {
      const metadata = match.metadata;
      const title = metadata.title || 'Untitled';
      const description = metadata.description || '';
      const score = (match.score * 100).toFixed(1);
      
      return `**${index + 1}. ${title}** (${score}% match)\n${description}`;
    }).join('\n\n');
  }

  // Helper method to extract context from search results
  extractContext(matches: PineconeMatch[], maxLength: number = 2000): string {
    const contexts: string[] = [];
    let totalLength = 0;

    for (const match of matches) {
      const text = match.metadata.text || match.metadata.description || '';
      const title = match.metadata.title || '';
      
      const context = title ? `${title}: ${text}` : text;
      
      if (totalLength + context.length > maxLength) {
        const remainingLength = maxLength - totalLength;
        if (remainingLength > 100) {
          contexts.push(context.substring(0, remainingLength) + '...');
        }
        break;
      }
      
      contexts.push(context);
      totalLength += context.length;
    }

    return contexts.join('\n\n');
  }
}