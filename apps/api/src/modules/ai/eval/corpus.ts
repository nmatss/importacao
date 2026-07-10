/**
 * Safe, versioned regression corpus for document extraction.
 *
 * Inputs are deliberately synthetic: no customer name, address, tax ID,
 * container number, e-mail, or production process code is allowed here. The
 * corpus can be passed to `runEval` with a provider adapter in a controlled
 * environment; CI validates fixture integrity and scorer behavior without
 * making an external AI call.
 */
import type { EvalCase } from './runner.js';

export const EVAL_CORPUS_VERSION = '2026-07-10.1';

const cf = (value: unknown, confidence = 1) => ({ value, confidence });

export const DOCUMENT_EXTRACTION_EVAL_CORPUS: readonly EvalCase[] = [
  {
    name: 'synthetic-invoice-basic-v1',
    docType: 'invoice',
    input: `COMMERCIAL INVOICE\nInvoice No: INV-TEST-001\nDate: 2026-01-15\nCurrency: USD\nSeller: EXAMPLE EXPORTS LTD\nTotal: USD 1,250.00`,
    gold: {
      invoiceNumber: cf('INV-TEST-001'),
      invoiceDate: cf('2026-01-15'),
      currency: cf('USD'),
      exporter: cf('EXAMPLE EXPORTS LTD'),
      totalFobValue: cf(1250),
    },
  },
  {
    name: 'synthetic-packing-list-cartons-v1',
    docType: 'packing_list',
    input: `PACKING LIST\nReference: PL-TEST-001\nQTY CARTONS: 48\nNET WEIGHT: 480 KG\nGROSS WEIGHT: 520 KG\nCBM: 3.20`,
    gold: {
      packingListNumber: cf('PL-TEST-001'),
      totalBoxes: cf(48),
      totalNetWeight: cf(480),
      totalGrossWeight: cf(520),
      totalCbm: cf(3.2),
    },
  },
  {
    name: 'synthetic-ohbl-freight-v1',
    docType: 'ohbl',
    input: `OCEAN BILL OF LADING\nB/L NO: BL-TEST-001\nPORT OF LOADING: NINGBO\nPORT OF DISCHARGE: SANTOS\nOCEAN FREIGHT: USD 950.00\nCONTAINER: TSTU0000001`,
    gold: {
      blNumber: cf('BL-TEST-001'),
      portOfLoading: cf('NINGBO'),
      portOfDischarge: cf('SANTOS'),
      freightValue: cf(950),
      freightCurrency: cf('USD'),
    },
  },
  {
    name: 'synthetic-duimp-registration-v1',
    docType: 'duimp',
    input: `DUIMP\nNUMBER: DUIMP-TEST-001\nREGISTRATION DATE: 2026-02-01\nCUSTOMS VALUE: USD 15,000.00\nCHANNEL: VERDE`,
    gold: {
      duimpNumber: cf('DUIMP-TEST-001'),
      registrationDate: cf('2026-02-01'),
      customsValue: cf(15000),
      customsChannel: cf('VERDE'),
    },
  },
];

export function validateEvalCorpus(cases = DOCUMENT_EXTRACTION_EVAL_CORPUS): string[] {
  const issues: string[] = [];
  const names = new Set<string>();
  for (const fixture of cases) {
    if (names.has(fixture.name)) issues.push(`duplicate case name: ${fixture.name}`);
    names.add(fixture.name);
    if (!fixture.name.startsWith('synthetic-'))
      issues.push(`case is not explicitly synthetic: ${fixture.name}`);
    if (!fixture.docType || !fixture.gold || !fixture.input)
      issues.push(`incomplete fixture: ${fixture.name}`);
    const source =
      typeof fixture.input === 'string' ? fixture.input : JSON.stringify(fixture.input);
    if (/\b\d{11}\b|\b\d{14}\b|@/u.test(source))
      issues.push(`possible personal data in input: ${fixture.name}`);
  }
  return issues;
}
