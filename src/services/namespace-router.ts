import { OpenAIService } from './openai';
import logger from '../utils/logger';

export interface NamespaceRouting {
  namespaces: string[];
  reasoning: string;
  confidence: number;
}

export class NamespaceRouter {
  private openai: OpenAIService;
  private unitMappings: Record<string, string>;

  constructor() {
    this.openai = new OpenAIService();
    this.unitMappings = {
      'unit-1': 'Getting started (basics, introduction, overview, fundamentals)',
      'unit-2': 'Setting up your business (legal, accounting, business structure, registration)',
      'unit-3': 'Product research (finding products, market analysis, competition, validation)',
      'unit-4': 'Creating your first listing (titles, descriptions, images, keywords, content)',
      'unit-5': 'Product sourcing and making your offer (suppliers, negotiations, samples, manufacturing)',
      'unit-6': 'Shipping your product to Amazon (logistics, FBA prep, transportation, inventory)',
      'unit-7': 'Finalizing your listing (optimization, final touches, compliance, approval)',
      'unit-8': 'Launching your product (launch strategies, initial sales, momentum, promotion)',
      'unit-9': 'Mastering PPC advertising (sponsored ads, campaigns, optimization, targeting)'
    };
  }

  async routeQuestion(question: string): Promise<NamespaceRouting> {
    try {
      logger.debug(`Routing question: ${question}`);

      const routingPrompt = this.buildRoutingPrompt(question);
      const response = await this.openai.createChatCompletion([
        { role: 'system', content: routingPrompt },
        { role: 'user', content: question }
      ], {
        temperature: 0.1,
        maxTokens: 300
      });

      const routingResult = this.parseRoutingResponse(response.content);
      
      logger.debug(`Routing result: ${JSON.stringify(routingResult)}`);
      return routingResult;

    } catch (error) {
      logger.error('Error routing question:', error);
      // Fallback to product research for ambiguous questions
      return {
        namespaces: ['unit-3'],
        reasoning: 'Fallback to product research due to routing error',
        confidence: 0.3
      };
    }
  }

  private buildRoutingPrompt(question: string): string {
    const unitDescriptions = Object.entries(this.unitMappings)
      .map(([unit, description]) => `${unit}: ${description}`)
      .join('\n');

    return `You are an expert FBA course content router. Your job is to analyze user questions and determine which course units are most relevant.

COURSE UNITS:
${unitDescriptions}

ROUTING RULES:
1. Return 1-3 most relevant namespaces (prefer fewer for better precision)
2. Consider the main topic and any subtopics
3. For multi-topic questions, include related units
4. Avoid including irrelevant units
5. Always provide confidence score (0.0-1.0)

RESPONSE FORMAT (JSON only):
{
  "namespaces": ["unit-X", "unit-Y"],
  "reasoning": "Brief explanation of why these units are relevant",
  "confidence": 0.8
}

EXAMPLES:
Question: "How do I optimize my manual targeting campaigns?"
Response: {"namespaces": ["unit-9"], "reasoning": "Question is specifically about PPC campaign optimization", "confidence": 0.95}

Question: "What makes a good listing title?"
Response: {"namespaces": ["unit-4", "unit-7"], "reasoning": "Listing creation and optimization both cover titles", "confidence": 0.9}

Question: "How do I start selling on Amazon?"
Response: {"namespaces": ["unit-1", "unit-2"], "reasoning": "Getting started and business setup are foundational", "confidence": 0.85}

Question: "How do I find profitable products?"
Response: {"namespaces": ["unit-3"], "reasoning": "Product research is the primary focus", "confidence": 0.9}

Now route this question:`;
  }

  private parseRoutingResponse(response: string): NamespaceRouting {
    try {
      // Clean up the response and extract JSON
      const cleanResponse = response.trim();
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate the response structure
      if (!parsed.namespaces || !Array.isArray(parsed.namespaces)) {
        throw new Error('Invalid namespaces format');
      }

      // Validate namespaces exist
      const validNamespaces = parsed.namespaces.filter((ns: string) => 
        this.unitMappings.hasOwnProperty(ns)
      );

      if (validNamespaces.length === 0) {
        throw new Error('No valid namespaces found');
      }

      return {
        namespaces: validNamespaces,
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: Math.min(Math.max(parsed.confidence || 0.5, 0.0), 1.0)
      };

    } catch (error) {
      logger.warn('Failed to parse routing response:', error);
      // Return fallback routing
      return {
        namespaces: ['unit-3'],
        reasoning: 'Fallback to product research due to parsing error',
        confidence: 0.3
      };
    }
  }

  // Helper method to get unit descriptions
  getUnitDescriptions(): Record<string, string> {
    return { ...this.unitMappings };
  }

  // Test method for validation
  async testRouting(testQuestions: string[]): Promise<void> {
    logger.info('Testing namespace routing...');
    
    for (const question of testQuestions) {
      const result = await this.routeQuestion(question);
      logger.info(`Question: "${question}"`);
      logger.info(`Routed to: ${result.namespaces.join(', ')}`);
      logger.info(`Reasoning: ${result.reasoning}`);
      logger.info(`Confidence: ${result.confidence}`);
      logger.info('---');
    }
  }
}