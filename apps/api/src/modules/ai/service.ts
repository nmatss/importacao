import { logger } from '../../shared/utils/logger.js';
import { buildInvoicePrompt } from './prompts/invoice.js';
import { buildPackingListPrompt } from './prompts/packing-list.js';
import { buildBLPrompt } from './prompts/bl.js';
import { buildAnomalyPrompt } from './prompts/anomaly.js';
import { buildEmailPrompt } from './prompts/email.js';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ExtractionResult {
  data: Record<string, any>;
  confidenceScore: number;
  fieldsWithLowConfidence: string[];
}

class AIService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  private async chat(model: string, messages: OpenRouterMessage[], jsonMode = true): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model,
      messages,
      response_format: { type: jsonMode ? 'json_object' : 'text' },
    };

    logger.debug({ model, messageCount: messages.length }, 'Sending request to OpenRouter');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'importacao-system',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText, model }, 'OpenRouter API error');
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ result }, 'Empty response from OpenRouter');
      throw new Error('Empty response from OpenRouter API');
    }

    logger.debug({ model, responseLength: content.length }, 'Received response from OpenRouter');
    return content;
  }

  private calculateConfidence(data: Record<string, any>): { score: number; lowConfidenceFields: string[] } {
    const lowConfidenceFields: string[] = [];
    let totalConfidence = 0;
    let fieldCount = 0;

    for (const [key, value] of Object.entries(data)) {
      if (key === 'items' && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          for (const [itemKey, itemValue] of Object.entries(value[i] as Record<string, any>)) {
            if (itemValue && typeof itemValue === 'object' && 'confidence' in itemValue) {
              const conf = (itemValue as { confidence: number }).confidence;
              totalConfidence += conf;
              fieldCount++;
              if (conf < 0.7) {
                lowConfidenceFields.push(`items[${i}].${itemKey}`);
              }
            }
          }
        }
      } else if (value && typeof value === 'object' && 'confidence' in value) {
        const conf = (value as { confidence: number }).confidence;
        totalConfidence += conf;
        fieldCount++;
        if (conf < 0.7) {
          lowConfidenceFields.push(key);
        }
      }
    }

    const score = fieldCount > 0 ? totalConfidence / fieldCount : 0;
    return { score, lowConfidenceFields };
  }

  private safeJsonParse(response: string, context: string): any {
    try {
      return JSON.parse(response);
    } catch (err) {
      logger.error({ err, context, rawResponse: response.substring(0, 500) }, 'Failed to parse AI JSON response');
      throw new Error(`Failed to parse AI response for ${context}: invalid JSON`);
    }
  }

  async extractInvoiceData(text: string): Promise<ExtractionResult> {
    const messages = buildInvoicePrompt(text);
    const response = await this.chat('google/gemini-2.0-flash-001', messages);
    const data = this.safeJsonParse(response, 'invoice extraction');
    const { score, lowConfidenceFields } = this.calculateConfidence(data);

    logger.info(
      { confidenceScore: score, lowConfidenceCount: lowConfidenceFields.length },
      'Invoice data extracted',
    );

    return { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields };
  }

  async extractPackingListData(text: string): Promise<ExtractionResult> {
    const messages = buildPackingListPrompt(text);
    const response = await this.chat('google/gemini-2.0-flash-001', messages);
    const data = this.safeJsonParse(response, 'packing list extraction');
    const { score, lowConfidenceFields } = this.calculateConfidence(data);

    logger.info(
      { confidenceScore: score, lowConfidenceCount: lowConfidenceFields.length },
      'Packing list data extracted',
    );

    return { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields };
  }

  async extractBLData(text: string): Promise<ExtractionResult> {
    const messages = buildBLPrompt(text);
    const response = await this.chat('google/gemini-2.0-flash-001', messages);
    const data = this.safeJsonParse(response, 'bill of lading extraction');
    const { score, lowConfidenceFields } = this.calculateConfidence(data);

    logger.info(
      { confidenceScore: score, lowConfidenceCount: lowConfidenceFields.length },
      'Bill of Lading data extracted',
    );

    return { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields };
  }

  async detectAnomalies(
    invoiceData: Record<string, any>,
    packingListData: Record<string, any>,
    blData: Record<string, any>,
  ): Promise<{ anomalies: Array<{ field: string; description: string; severity: string }> }> {
    const messages = buildAnomalyPrompt(invoiceData, packingListData, blData);
    const response = await this.chat('anthropic/claude-sonnet-4', messages);
    const result = this.safeJsonParse(response, 'anomaly detection');

    logger.info(
      { anomalyCount: result.anomalies?.length ?? 0 },
      'Anomaly detection completed',
    );

    return result;
  }

  async generateEmailDraft(
    processData: Record<string, any>,
    recipientType: 'fenicia' | 'isa',
  ): Promise<{ subject: string; body: string }> {
    const messages = buildEmailPrompt(processData, recipientType);
    const response = await this.chat('google/gemini-2.0-flash-001', messages);
    const result = this.safeJsonParse(response, 'email draft generation');

    logger.info({ recipientType }, 'Email draft generated');

    return result;
  }

  async validateNcm(
    description: string,
    ncmCode: string,
  ): Promise<{ isValid: boolean; suggestion?: string; confidence: number }> {
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are a Brazilian customs classification expert. Your task is to validate whether a given NCM (Nomenclatura Comum do Mercosul) code is correct for the described product.

Respond with strict JSON in this format:
{
  "isValid": true/false,
  "suggestion": "Suggested correct NCM code if invalid, or null if valid",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why the code is valid or what the correct code should be"
}

Rules:
- NCM codes follow the format XXXX.XX.XX (8 digits).
- Consider the product description carefully, including material, use, and category.
- If the code seems correct, set isValid to true and suggestion to null.
- If the code is incorrect, suggest the most likely correct NCM code.
- Confidence should reflect how sure you are about the validation.
- Respond ONLY with the JSON object, no additional text.`,
      },
      {
        role: 'user',
        content: `Validate this NCM classification:\n\nProduct description: ${description}\nNCM code: ${ncmCode}`,
      },
    ];

    const response = await this.chat('google/gemini-2.0-flash-001', messages);
    const result = this.safeJsonParse(response, 'NCM validation');

    logger.info({ ncmCode, isValid: result.isValid }, 'NCM validation completed');

    return {
      isValid: result.isValid,
      suggestion: result.suggestion ?? undefined,
      confidence: result.confidence,
    };
  }
}

export const aiService = new AIService();
