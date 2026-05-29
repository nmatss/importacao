import { logger } from '../../shared/utils/logger.js';
import { withRetry, withTimeout } from '../../shared/utils/resilience.js';
import { logAIRequest } from './governance.js';
import { invoiceResponseSchema } from './schemas/invoice-response.js';
import { proformaResponseSchema } from './schemas/proforma-response.js';
import { packingListResponseSchema } from './schemas/packing-list-response.js';
import { blResponseSchema } from './schemas/bl-response.js';
import { draftBLResponseSchema } from './schemas/draft-bl-response.js';
import { emailAnalysisResponseSchema } from './schemas/email-analysis-response.js';
import { buildInvoicePrompt } from './prompts/invoice.js';
import { buildProformaPrompt } from './prompts/proforma.js';
import { buildPackingListPrompt } from './prompts/packing-list.js';
import { buildBLPrompt } from './prompts/bl.js';
import { buildAnomalyPrompt } from './prompts/anomaly.js';
import { buildEmailPrompt } from './prompts/email.js';
import { buildEmailAnalysisPrompt } from './prompts/email-analysis.js';
import { buildCorrectionPrompt } from './prompts/correction.js';
import { buildCertificatePrompt } from './prompts/certificate.js';
import { buildDraftBLPrompt } from './prompts/draft-bl.js';
import { buildEspelhoPrompt } from './prompts/espelho.js';
import { certificateResponseSchema } from './schemas/certificate-response.js';
import { espelhoResponseSchema } from './schemas/espelho-response.js';
import type { ZodType } from 'zod';
import { OpenRouterProvider } from './providers/openrouter.js';
import { VertexAIProvider } from './providers/vertex.js';
import type { AIProvider, ChatOptions } from './providers/types.js';
import { assertBudgetAvailable, logUsage, AIBudgetExceededError } from './cost-tracker.js';
import { EXTRACTION_SCHEMAS } from './extraction-schemas.js';
import { verifyExtraction } from './harness/index.js';
import { getVerificationConfig } from './skills/registry.js';

export { AIBudgetExceededError };

/** When set, the chat() call uses structured-output mode (responseSchema). */
const USE_STRUCTURED_OUTPUT = process.env.AI_STRUCTURED_OUTPUT !== '0';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface ImageExtractionOpts {
  imageBase64: string;
  imageMimeType?: string;
}

export interface EmailAnalysisResult {
  processCode: string | null;
  documentTypes: string[];
  invoiceNumbers: string[];
  urgencyLevel: 'normal' | 'urgent' | 'critical';
  emailCategory:
    | 'new_shipment'
    | 'document_delivery'
    | 'correction'
    | 'follow_up'
    | 'payment'
    | 'general'
    | 'pre_confirmation'
    | 'tracking_sent';
  keyDates: Array<{ type: string; date: string; description: string }>;
  supplierName: string | null;
}

interface ExtractionResult {
  data: Record<string, any>;
  confidenceScore: number;
  fieldsWithLowConfidence: string[];
}

// ── Model fallback chains ────────────────────────────────────────────
// Ordered list of models to try — primary first, then fallbacks in order
const MODEL_FALLBACK_CHAIN: string[] = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];

// ── Prompt versions (for governance tracking) ────────────────────────

const PROMPT_VERSIONS: Record<string, string> = {
  invoice_extraction: 'v1.0',
  packing_list_extraction: 'v1.0',
  bl_extraction: 'v1.0',
  anomaly_detection: 'v1.0',
  email_draft: 'v1.0',
  email_analysis: 'v1.0',
  ncm_validation: 'v1.0',
  correction_email: 'v1.0',
  certificate_extraction: 'v1.0',
  draft_bl_extraction: 'v1.0',
  proforma_extraction: 'v1.0',
  espelho_extraction: 'v1.0',
};

/**
 * Strip a spurious single-letter prefix that sometimes bleeds in from the
 * adjacent packaging column in PDF layouts (e.g. every itemCode arrives as
 * "W7765Y" instead of "7765Y" because the layout glued "WHITE BOX" to the
 * code column).
 *
 * SAFETY RULES — only strip when ALL conditions hold:
 *   1) There are ≥3 items with itemCodes.
 *   2) ≥80% of items match the shape LETTER + DIGIT at positions 0..1.
 *      A letter followed by a DIGIT is the shape of noise bleed; a letter
 *      followed by a LETTER (e.g. "PI7765Y", "AC2285Y") is a legitimate
 *      2-char vendor prefix used by Uni.co and MUST NOT be stripped. This
 *      is the core fix for the regression found against DEMO-IM0712602NB
 *      on 2026-04-11 where the previous heuristic (LETTER + LETTER|DIGIT
 *      ≥70%) stripped the legitimate "P" of "PI7765Y" and broke
 *      item-level-match.
 *   3) All of those matching items share the SAME leading letter (if they
 *      don't, there's no single bleed signal — don't touch anything).
 *   4) Stripping produces a code of ≥3 chars (avoid creating 1-char junk).
 * Only items that themselves match rule 2 are stripped; items with legit
 * letter+letter prefixes (like AC2285Y in a mixed batch) stay untouched.
 */
function stripSpuriousItemPrefix(items: any[]): void {
  if (!Array.isArray(items) || items.length < 3) return;

  // Rule 2: letter followed by a digit at position 0..1
  const noisePattern = /^[A-Z]\d/;

  const codedItems: { item: any; code: string }[] = [];
  for (const item of items) {
    const code = item?.itemCode?.value;
    if (typeof code === 'string' && code.length > 0) {
      codedItems.push({ item, code });
    }
  }
  if (codedItems.length < 3) return;

  const matches = codedItems.filter((c) => noisePattern.test(c.code));
  const ratio = matches.length / codedItems.length;
  if (ratio < 0.8) return;

  const firstLetter = matches[0].code[0];
  if (!matches.every((m) => m.code[0] === firstLetter)) return;

  // Rule 4: post-strip length ≥3
  if (matches.some((m) => m.code.length - 1 < 3)) return;

  let stripped = 0;
  for (const { item, code } of matches) {
    item.itemCode.value = code.slice(1);
    stripped++;
  }

  if (stripped > 0) {
    logger.warn(
      { prefix: firstLetter, strippedCount: stripped, totalWithCode: codedItems.length, ratio },
      'Stripped spurious single-letter prefix from item codes (likely packaging column bleed)',
    );
  }
}

/**
 * Flatten AI response from { value, confidence } structure to plain values.
 * Validation checks and comparison logic need plain values, not nested objects.
 */
export function flattenAiData(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(data)) {
    // Campos meta (ex.: _trust do harness) não são dados extraídos — não devem
    // poluir validação/comparativo/UI.
    if (key.startsWith('_')) continue;
    if (key === 'items' && Array.isArray(val)) {
      result[key] = val.map((item: Record<string, any>) => {
        const flatItem: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
          flatItem[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
        }
        return flatItem;
      });
    } else if (val && typeof val === 'object' && 'value' in val) {
      result[key] = val.value;
    } else {
      result[key] = val;
    }
  }
  return result;
}

class AIService {
  private provider: AIProvider;

  constructor() {
    const providerName = (process.env.AI_PROVIDER || 'openrouter').toLowerCase();
    this.provider = providerName === 'vertex' ? new VertexAIProvider() : new OpenRouterProvider();
    logger.info({ provider: this.provider.name }, 'AIService initialized');
  }

  /**
   * Build a multimodal user message with image if available, falling back to text-only.
   */
  private buildUserMessage(
    textContent: string,
    imageOpts?: ImageExtractionOpts,
  ): OpenRouterMessage {
    if (imageOpts?.imageBase64) {
      const mime = imageOpts.imageMimeType || 'image/png';
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${imageOpts.imageBase64}` },
        },
      ];
      if (textContent) {
        parts.unshift({ type: 'text', text: textContent });
      }
      return { role: 'user', content: parts };
    }
    return { role: 'user', content: textContent };
  }

  private async chat(
    model: string,
    messages: OpenRouterMessage[],
    jsonMode = true,
    context = 'unknown',
    responseSchema?: Record<string, unknown>,
  ): Promise<string> {
    const promptVersion = PROMPT_VERSIONS[context] || 'v1.0';

    // Budget gate: when the monthly cap is in effect (AI_MONTHLY_BUDGET_USD),
    // refuse the call before it goes out. The error is treated by callers as
    // "extraction failed" — same path as a low-confidence response.
    await assertBudgetAvailable();

    // Build fallback chain starting from the requested model position
    const startIdx = MODEL_FALLBACK_CHAIN.indexOf(model);
    const modelsToTry =
      startIdx >= 0 ? MODEL_FALLBACK_CHAIN.slice(startIdx) : [model, ...MODEL_FALLBACK_CHAIN];

    let lastError: Error | unknown;

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      const isRetry = i > 0;
      const attemptContext = isRetry ? `${context}:fallback-${currentModel}` : context;

      if (isRetry) {
        logger.warn(
          { primaryModel: modelsToTry[0], currentModel, context, attempt: i + 1 },
          'Falling back to next model in chain',
        );
      }

      const attemptStart = Date.now();
      try {
        const result = await withRetry(
          () =>
            withTimeout(
              (signal) =>
                this.provider.callModel(currentModel, messages, {
                  jsonMode,
                  responseSchema,
                  signal,
                } satisfies ChatOptions),
              90_000,
              `${currentModel}/${context}`,
            ),
          { attempts: 2, baseDelayMs: 1000, maxDelayMs: 5000 },
          `ai:${currentModel}`,
        );

        const latencyMs = Date.now() - attemptStart;
        logAIRequest({
          model: currentModel,
          promptVersion,
          latencyMs,
          status: 'success',
          context: attemptContext,
        });
        // Best-effort persist of usage. Failure logs internally, never throws.
        await logUsage({
          provider: this.provider.name,
          model: currentModel,
          context: attemptContext,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
        logger.info(
          {
            model: currentModel,
            context,
            isRetry,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
          },
          'AI model responded successfully',
        );

        return result.content;
      } catch (err: any) {
        if (err instanceof AIBudgetExceededError) {
          // Budget exhausted — no point trying other models in the chain.
          throw err;
        }
        lastError = err;
        const latencyMs = Date.now() - attemptStart;
        // Some failures still consume tokens (timeouts after generation,
        // partial responses). Persist usage if the error carries it so the
        // budget cap doesn't drift below reality.
        const errUsage = err?.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        if (errUsage && (errUsage.inputTokens || errUsage.outputTokens)) {
          await logUsage({
            provider: this.provider.name,
            model: currentModel,
            context: `${attemptContext}:error`,
            inputTokens: errUsage.inputTokens ?? 0,
            outputTokens: errUsage.outputTokens ?? 0,
            status: 'error',
          });
        }
        logAIRequest({
          model: currentModel,
          promptVersion,
          latencyMs,
          status: 'error',
          errorMessage: err.message,
          context: attemptContext,
        });
        logger.error({ err, model: currentModel, context }, 'AI model request failed');
      }
    }

    logger.error(
      { modelsAttempted: modelsToTry, context },
      'All AI models in fallback chain failed',
    );
    throw lastError;
  }

  /**
   * Wraps an extraction call with optional model-upgrade-on-low-confidence.
   * When the primary model returns confidence below threshold, retry with the
   * upgrade model and keep whichever response scored higher — BUT only when
   * the upgrade beats the primary by a meaningful margin (default 5pp). This
   * prevents paying for Pro when Pro returns ~the same confidence as Flash.
   * Controlled by AI_UPGRADE_ON_LOW_CONFIDENCE (default ON) — set to "0" to
   * disable. Margin tunable via AI_UPGRADE_MIN_DELTA (default 0.05).
   */
  private async extractWithUpgrade<T extends ExtractionResult>(
    label: string,
    primary: string,
    upgrade: string,
    runOnce: (model: string) => Promise<T>,
  ): Promise<T> {
    const first = await runOnce(primary);
    if (process.env.AI_UPGRADE_ON_LOW_CONFIDENCE === '0') return first;
    const threshold = Number(process.env.AI_UPGRADE_CONFIDENCE_THRESHOLD ?? '0.7');
    const minDelta = Number(process.env.AI_UPGRADE_MIN_DELTA ?? '0.05');
    if (first.confidenceScore >= threshold) return first;
    try {
      logger.info(
        { label, primary, upgrade, primaryConfidence: first.confidenceScore, threshold },
        'Low confidence — re-extracting with upgrade model',
      );
      const second = await runOnce(upgrade);
      // Short-circuit waste: only adopt the upgrade when it improves by >=
      // minDelta. Otherwise the extra cost bought us nothing and we keep
      // the primary result.
      if (second.confidenceScore - first.confidenceScore >= minDelta) {
        return second;
      }
      logger.info(
        {
          label,
          primary,
          upgrade,
          primaryConfidence: first.confidenceScore,
          upgradeConfidence: second.confidenceScore,
          minDelta,
        },
        'Upgrade did not improve confidence by minDelta — keeping primary result',
      );
      return first;
    } catch (err) {
      // Upgrade attempt failed (budget? timeout?) — keep the primary result.
      logger.warn({ err, label, upgrade }, 'Upgrade extraction failed; returning primary result');
      return first;
    }
  }

  private calculateConfidence(data: Record<string, any>): {
    score: number;
    lowConfidenceFields: string[];
  } {
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

  /**
   * Confidence harness — runs deterministic trust checks (grounding / format /
   * numeric / knowledge) over an extraction and folds the verdict back in:
   *  - attaches the trust report to data._trust (persisted for audit),
   *  - unions review fields into the low-confidence list,
   *  - and, on error findings, caps confidence below the 0.4 review gate so the
   *    document pipeline routes the extraction to human review.
   * Grounding is skipped when the source text is too short to verify (scanned /
   * image-only PDFs), to avoid false hallucination alarms.
   */
  private applyHarness(
    docType: string,
    result: ExtractionResult,
    sourceText: string,
  ): ExtractionResult {
    const config = getVerificationConfig(docType);
    if (!config) return result;

    const groundingViable = (sourceText ?? '').replace(/\s/g, '').length >= 50;
    const effectiveConfig = groundingViable ? config : { ...config, groundedFields: [] };

    const report = verifyExtraction(
      effectiveConfig,
      result.data,
      sourceText ?? '',
      new Date().toISOString(),
    );
    (result.data as Record<string, any>)._trust = report;

    if (report.findings.length > 0) {
      logger.info(
        {
          docType,
          trust: report.trust,
          findings: report.findings.length,
          reviewFields: report.reviewFields,
          groundingViable,
        },
        'AI harness verification',
      );
    }

    const fieldsWithLowConfidence = [
      ...new Set([...result.fieldsWithLowConfidence, ...report.reviewFields]),
    ];
    const confidenceScore =
      report.trust === 'review'
        ? Math.min(result.confidenceScore, 0.39)
        : Math.min(result.confidenceScore, report.adjustedConfidence);

    return { ...result, confidenceScore, fieldsWithLowConfidence };
  }

  private safeJsonParse(response: string, context: string): any {
    try {
      return JSON.parse(response);
    } catch (err) {
      logger.error(
        { err, context, rawResponse: response.substring(0, 500) },
        'Failed to parse AI JSON response',
      );
      throw new Error(`Failed to parse AI response for ${context}: invalid JSON`);
    }
  }

  /**
   * Parse JSON and validate with Zod schema.
   * Falls back to raw parsed data if validation fails, logging a warning.
   */
  private zodParse<T>(response: string, context: string, schema: ZodType<T>): T {
    const raw = this.safeJsonParse(response, context);
    const result = schema.safeParse(raw);
    if (result.success) {
      return result.data;
    }

    logger.warn(
      { context, errors: result.error.issues.slice(0, 5), rawKeys: Object.keys(raw) },
      'AI response Zod validation failed, using raw parsed data — downstream may see unexpected shapes',
    );
    return raw as T;
  }

  async extractInvoiceData(
    text: string,
    imageOpts?: ImageExtractionOpts,
  ): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildInvoicePrompt(text) as OpenRouterMessage[];
    // Replace user message with multimodal version if image available
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    return this.extractWithUpgrade(
      'invoice',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      async (model) => {
        const response = await this.chat(
          model,
          messages,
          true,
          'invoice_extraction',
          USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.invoice : undefined,
        );
        const data = this.zodParse(response, 'invoice extraction', invoiceResponseSchema);
        const dataAsRecord = data as Record<string, any>;
        if (Array.isArray(dataAsRecord.items)) {
          stripSpuriousItemPrefix(dataAsRecord.items);
        }
        const { score, lowConfidenceFields } = this.calculateConfidence(dataAsRecord);
        logger.info(
          {
            model,
            confidenceScore: score,
            lowConfidenceCount: lowConfidenceFields.length,
            hasImage: !!imageOpts,
          },
          'Invoice data extracted',
        );
        return this.applyHarness(
          'invoice',
          {
            data: data as Record<string, any>,
            confidenceScore: score,
            fieldsWithLowConfidence: lowConfidenceFields,
          },
          text,
        );
      },
    );
  }

  async extractProformaData(
    text: string,
    imageOpts?: ImageExtractionOpts,
  ): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildProformaPrompt(text) as OpenRouterMessage[];
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    return this.extractWithUpgrade(
      'proforma',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      async (model) => {
        const response = await this.chat(
          model,
          messages,
          true,
          'proforma_extraction',
          USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.proforma : undefined,
        );
        const data = this.zodParse(response, 'proforma extraction', proformaResponseSchema);
        const dataAsRecord = data as Record<string, any>;
        if (Array.isArray(dataAsRecord.items)) {
          stripSpuriousItemPrefix(dataAsRecord.items);
        }
        const { score, lowConfidenceFields } = this.calculateConfidence(dataAsRecord);
        logger.info(
          {
            model,
            confidenceScore: score,
            lowConfidenceCount: lowConfidenceFields.length,
            hasImage: !!imageOpts,
          },
          'Proforma invoice data extracted',
        );
        return {
          data: data as Record<string, any>,
          confidenceScore: score,
          fieldsWithLowConfidence: lowConfidenceFields,
        };
      },
    );
  }

  async extractPackingListData(
    text: string,
    imageOpts?: ImageExtractionOpts,
  ): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildPackingListPrompt(text) as OpenRouterMessage[];
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    return this.extractWithUpgrade(
      'packing_list',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      async (model) => {
        const response = await this.chat(
          model,
          messages,
          true,
          'packing_list_extraction',
          USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.packing_list : undefined,
        );
        const data = this.zodParse(response, 'packing list extraction', packingListResponseSchema);
        const dataAsRecord = data as Record<string, any>;
        if (Array.isArray(dataAsRecord.items)) {
          stripSpuriousItemPrefix(dataAsRecord.items);
        }
        const { score, lowConfidenceFields } = this.calculateConfidence(data);
        logger.info(
          {
            model,
            confidenceScore: score,
            lowConfidenceCount: lowConfidenceFields.length,
            hasImage: !!imageOpts,
          },
          'Packing list data extracted',
        );
        return this.applyHarness(
          'packing_list',
          { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields },
          text,
        );
      },
    );
  }

  async extractBLData(text: string, imageOpts?: ImageExtractionOpts): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildBLPrompt(text) as OpenRouterMessage[];
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    return this.extractWithUpgrade('bl', 'gemini-2.5-flash', 'gemini-2.5-pro', async (model) => {
      const response = await this.chat(
        model,
        messages,
        true,
        'bl_extraction',
        USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.bl : undefined,
      );
      const data = this.zodParse(response, 'bill of lading extraction', blResponseSchema);
      const { score, lowConfidenceFields } = this.calculateConfidence(data);
      logger.info(
        {
          model,
          confidenceScore: score,
          lowConfidenceCount: lowConfidenceFields.length,
          hasImage: !!imageOpts,
        },
        'Bill of Lading data extracted',
      );
      return this.applyHarness(
        'ohbl',
        { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields },
        text,
      );
    });
  }

  async extractDraftBLData(
    text: string,
    imageOpts?: ImageExtractionOpts,
  ): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildDraftBLPrompt(text) as OpenRouterMessage[];
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    const response = await this.chat(
      'gemini-2.5-flash',
      messages,
      true,
      'draft_bl_extraction',
      USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.draft_bl : undefined,
    );
    const data = this.zodParse(response, 'draft bill of lading extraction', draftBLResponseSchema);
    const { score, lowConfidenceFields } = this.calculateConfidence(data);

    logger.info(
      {
        confidenceScore: score,
        lowConfidenceCount: lowConfidenceFields.length,
        hasImage: !!imageOpts,
      },
      'Draft BL data extracted',
    );

    return this.applyHarness(
      'draft_bl',
      { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields },
      text,
    );
  }

  /**
   * AI fallback for Espelho extraction. Only used when the deterministic
   * XLSX parser (tryParseEspelhoBuffer) fails because the layout differs
   * from the known format. Disabled by default — set ESPELHO_AI_FALLBACK=1
   * to enable, and only do so when AI_PROVIDER=vertex (privacy: espelho
   * carries sensitive Pre-Cons-linked data).
   */
  async extractEspelhoData(text: string): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildEspelhoPrompt(text) as OpenRouterMessage[];
    return this.extractWithUpgrade(
      'espelho',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      async (model) => {
        const response = await this.chat(
          model,
          msgs,
          true,
          'espelho_extraction',
          USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.espelho : undefined,
        );
        const data = this.zodParse(response, 'espelho extraction', espelhoResponseSchema);
        const { score, lowConfidenceFields } = this.calculateConfidence(
          data as Record<string, any>,
        );
        logger.info(
          { model, confidenceScore: score, lowConfidenceCount: lowConfidenceFields.length },
          'Espelho data extracted via AI fallback',
        );
        return {
          data: data as Record<string, any>,
          confidenceScore: score,
          fieldsWithLowConfidence: lowConfidenceFields,
        };
      },
    );
  }

  async extractCertificateData(
    text: string,
    imageOpts?: ImageExtractionOpts,
  ): Promise<ExtractionResult> {
    const msgs: OpenRouterMessage[] = buildCertificatePrompt(text) as OpenRouterMessage[];
    if (imageOpts) {
      msgs[msgs.length - 1] = this.buildUserMessage(
        msgs[msgs.length - 1].content as string,
        imageOpts,
      );
    }
    const messages = msgs;
    const response = await this.chat(
      'gemini-2.5-flash',
      messages,
      true,
      'certificate_extraction',
      USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.certificate : undefined,
    );
    const data = this.zodParse(response, 'certificate extraction', certificateResponseSchema);
    const { score, lowConfidenceFields } = this.calculateConfidence(data);

    logger.info(
      {
        confidenceScore: score,
        lowConfidenceCount: lowConfidenceFields.length,
        hasImage: !!imageOpts,
      },
      'Certificate data extracted',
    );

    return { data, confidenceScore: score, fieldsWithLowConfidence: lowConfidenceFields };
  }

  async detectAnomalies(
    invoiceData: Record<string, any>,
    packingListData: Record<string, any>,
    blData: Record<string, any>,
  ): Promise<{ anomalies: Array<{ field: string; description: string; severity: string }> }> {
    const messages = buildAnomalyPrompt(invoiceData, packingListData, blData);
    const response = await this.chat('gemini-2.5-flash', messages, true, 'anomaly_detection');
    const result = this.safeJsonParse(response, 'anomaly detection');

    logger.info({ anomalyCount: result.anomalies?.length ?? 0 }, 'Anomaly detection completed');

    return result;
  }

  async generateEmailDraft(
    processData: Record<string, any>,
    recipientType: 'fenicia' | 'isa',
  ): Promise<{ subject: string; body: string }> {
    const messages = buildEmailPrompt(processData, recipientType);
    const response = await this.chat('gemini-2.5-flash', messages, true, 'email_draft');
    const result = this.safeJsonParse(response, 'email draft generation');

    logger.info({ recipientType }, 'Email draft generated');

    return result;
  }

  async analyzeEmail(
    subject: string,
    body: string,
    fromAddress: string,
  ): Promise<EmailAnalysisResult> {
    const truncatedBody = body.substring(0, 2000);
    const messages = buildEmailAnalysisPrompt(subject, truncatedBody, fromAddress);
    const response = await this.chat(
      'gemini-2.5-flash',
      messages,
      true,
      'email_analysis',
      USE_STRUCTURED_OUTPUT ? EXTRACTION_SCHEMAS.email_analysis : undefined,
    );
    const result = this.zodParse(response, 'email analysis', emailAnalysisResponseSchema);

    logger.info(
      {
        processCode: result.processCode,
        category: result.emailCategory,
        urgency: result.urgencyLevel,
        documentTypes: result.documentTypes?.length ?? 0,
      },
      'Email analysis completed',
    );

    return {
      processCode: result.processCode || null,
      documentTypes: Array.isArray(result.documentTypes) ? result.documentTypes : [],
      invoiceNumbers: Array.isArray(result.invoiceNumbers) ? result.invoiceNumbers : [],
      urgencyLevel: result.urgencyLevel || 'normal',
      emailCategory: result.emailCategory || 'general',
      keyDates: Array.isArray(result.keyDates) ? result.keyDates : [],
      supplierName: result.supplierName || null,
    };
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

    const response = await this.chat('gemini-2.5-flash', messages, true, 'ncm_validation');
    const result = this.safeJsonParse(response, 'NCM validation');

    logger.info({ ncmCode, isValid: result.isValid }, 'NCM validation completed');

    return {
      isValid: result.isValid,
      suggestion: result.suggestion ?? undefined,
      confidence: result.confidence,
    };
  }

  async generateCorrectionEmail(context: {
    processCode: string;
    brand: string;
    invoiceNumber?: string;
    exporterName?: string;
    divergences: Array<{
      checkName: string;
      category: string;
      expectedValue?: string;
      actualValue?: string;
      message: string;
    }>;
  }): Promise<{ subject: string; body: string }> {
    const messages = buildCorrectionPrompt(context);
    const response = await this.chat('gemini-2.5-flash', messages, true, 'correction_email');
    const result = this.safeJsonParse(response, 'correction email generation');

    logger.info(
      { processCode: context.processCode, divergenceCount: context.divergences.length },
      'Correction email draft generated by AI',
    );

    return { subject: result.subject, body: result.body };
  }
}

export const aiService = new AIService();
