import { describe, it, expect } from 'vitest';
import { getSkill, getVerificationConfig } from '../registry.js';
import { assembleSpecialistMessages } from '../assemble.js';
import { retrieveContext } from '../../rag/retriever.js';
import { verifyExtraction } from '../../harness/index.js';
import { invoiceResponseSchema } from '../../schemas/invoice-response.js';
import { EXTRACTION_SCHEMAS } from '../../extraction-schemas.js';
import { OpenRouterProvider } from '../../providers/openrouter.js';
import type { ChatMessage } from '../../providers/types.js';

/**
 * LIVE end-to-end validation of the specialist pipeline (AI_USE_SPECIALIST path)
 * against a REAL fast provider — the proof the team/audit asked for before
 * flipping the flag in production. It replays exactly what service.ts'
 * buildExtractionMessages does (getSkill -> retrieveContext ->
 * assembleSpecialistMessages), calls the provider DIRECTLY (no DB/budget/
 * governance), parses, and runs the trust harness.
 *
 * SKIPPED by default — only runs when a real OPENROUTER_API_KEY is present:
 *   OPENROUTER_API_KEY=sk-... npx vitest run validate-live
 * Run it on the server (which has the key) or anywhere a key is available.
 * It makes one real (paid) API call.
 */
const KEY = process.env.OPENROUTER_API_KEY;
const LIVE = !!KEY && KEY !== 'your-openrouter-api-key';

// A synthetic-but-realistic Commercial Invoice (text path — no real customer
// document needed to validate that the specialist prompt drives correct reads).
const INVOICE_TEXT = `COMMERCIAL INVOICE
Invoice No: INV-9001        Date: 2026-05-12
Exporter: ZHUJI QINGTAI SOCKS CO., LTD. - NINGBO, CHINA
Importer: UNI.CO COMERCIO S/A - SAO PAULO, BRASIL  CNPJ: 11.222.333/0001-81
Incoterm: FOB        Currency: USD
Port of Loading: NINGBO        Port of Discharge: ITAPOA, BRAZIL

Item   Code      Description          Qty     Unit Price   Amount     NCM
1      7765Y     MEIA INFANTIL        1200    0.85         1020.00    6115.95.00
2      SAMPLE01  AMOSTRA (FREE)        10     0.00         0.00       -

TOTAL FOB: USD 1020.00`;

describe.skipIf(!LIVE)('LIVE: specialist pipeline vs fast provider', () => {
  it('extracts the invoice correctly and passes the trust harness (zero errors)', async () => {
    const skill = getSkill('invoice')!;
    const ctx = retrieveContext(INVOICE_TEXT, skill.retrieval);
    const messages = assembleSpecialistMessages(
      skill,
      { documentText: INVOICE_TEXT },
      ctx,
    ) as ChatMessage[];

    const provider = new OpenRouterProvider();
    const resp = await provider.callModel('gemini-2.5-flash', messages, {
      jsonMode: true,
      responseSchema: EXTRACTION_SCHEMAS.invoice as Record<string, unknown>,
    });
    const data = invoiceResponseSchema.parse(JSON.parse(resp.content));

    // The model read the key fields right.
    expect(data.invoiceNumber.value).toBe('INV-9001');
    expect(data.currency.value).toBe('USD');
    expect(String(data.portOfDischarge.value).toUpperCase()).toContain('ITAPOA');
    const codes = data.items.map((i) => i.itemCode.value);
    expect(codes).toContain('7765Y'); // not "W7765Y" / not prefix-mangled
    // FOC item excluded from the FOB total.
    expect(data.totalFobValue.value).toBeCloseTo(1020, 1);

    // The trust harness accepts the extraction (no hard errors).
    const report = verifyExtraction(
      getVerificationConfig('invoice')!,
      data as Record<string, unknown>,
      INVOICE_TEXT,
      '2026-06-14T00:00:00.000Z',
    );
    const errors = report.findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) throw new Error(`harness errors: ${JSON.stringify(errors)}`);
    expect(errors).toEqual([]);
  }, 60_000);
});
