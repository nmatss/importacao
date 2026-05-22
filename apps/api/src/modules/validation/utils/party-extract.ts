/**
 * Splits a multi-line shipper/consignee/exporter/importer blob from a BL or
 * commercial invoice into structured parts:
 *   - name: first non-address line (company name)
 *   - address: subsequent lines (everything except CNPJ/contact tokens)
 *   - taxId: detected Brazilian CNPJ/CPF or generic tax id string
 *
 * Inputs typically look like:
 *   KIOM INDUSTRY CO., LTD
 *   ROOM 1903, 19/F, BUILDING 1, NO. 88 SHANXI ROAD
 *   SHANGHAI, CHINA 200000
 *   TEL: +86 21 1234 5678
 */

import { extractCompanyLine } from './name-normalize.js';

const CNPJ_RE = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/;
const CPF_RE = /\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/;
const TAX_ID_HINT_RE = /\b(?:cnpj|cpf|tax\s*id|ein|vat|nif)[\s:.-]*([A-Z0-9.\-/]+)\b/i;
const CONTACT_HINT_RE = /^\s*(?:tel\.?|phone|fax|e?\s*-?\s*mail|email|@)/i;

export interface PartyParts {
  raw: string;
  name: string;
  address: string;
  taxId: string;
}

export function extractPartyParts(value: unknown): PartyParts {
  const raw = String(value ?? '').trim();
  if (!raw) return { raw: '', name: '', address: '', taxId: '' };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const name = extractCompanyLine(raw);

  let taxId = '';
  const cnpjMatch = raw.match(CNPJ_RE);
  if (cnpjMatch) taxId = cnpjMatch[1];
  if (!taxId) {
    const cpfMatch = raw.match(CPF_RE);
    if (cpfMatch) taxId = cpfMatch[1];
  }
  if (!taxId) {
    const hintMatch = raw.match(TAX_ID_HINT_RE);
    if (hintMatch) taxId = hintMatch[1];
  }

  const addressLines: string[] = [];
  for (const line of lines) {
    if (line === name) continue;
    if (CONTACT_HINT_RE.test(line)) continue;
    if (taxId && line.includes(taxId)) continue;
    if (TAX_ID_HINT_RE.test(line)) continue;
    addressLines.push(line);
  }

  return {
    raw,
    name,
    address: addressLines.join(', '),
    taxId,
  };
}
