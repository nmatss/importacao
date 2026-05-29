/**
 * Skill registry — maps a document type to its extraction skill (schema +
 * verification recipe). The AI service looks the skill up after extraction and
 * runs the harness with the skill's verification config.
 */

import { invoiceResponseSchema } from '../schemas/invoice-response.js';
import { packingListResponseSchema } from '../schemas/packing-list-response.js';
import { blResponseSchema } from '../schemas/bl-response.js';
import { draftBLResponseSchema } from '../schemas/draft-bl-response.js';
import { approxEqual, fieldNum, finding } from '../harness/numeric.js';
import type { HarnessFinding, VerificationConfig } from '../harness/types.js';
import type { ExtractionSkill } from './types.js';

const PORTS: VerificationConfig['portFields'] = [
  { field: 'portOfLoading', kind: 'loading' },
  { field: 'portOfDischarge', kind: 'discharge' },
];

/** Σ(item.totalPrice excluindo FOC) ≈ totalFobValue declarado. */
function invoiceTotalsCheck(data: Record<string, any>): HarnessFinding | null {
  const total = fieldNum(data, 'totalFobValue');
  const items = Array.isArray(data.items) ? data.items : [];
  if (total == null || items.length === 0) return null;
  let sum = 0;
  let counted = false;
  for (const it of items) {
    if (it?.isFreeOfCharge?.value === true) continue;
    const tp = it?.totalPrice?.value;
    if (typeof tp === 'number' && Number.isFinite(tp)) {
      sum += tp;
      counted = true;
    }
  }
  if (!counted) return null;
  return approxEqual(sum, total, 0.02)
    ? null
    : finding(
        'totalFobValue',
        `soma dos itens (${sum.toFixed(2)}) diverge do FOB declarado (${total.toFixed(2)})`,
        'warning',
      );
}

/** Peso líquido total não pode exceder o bruto total. */
function netLeGrossCheck(data: Record<string, any>): HarnessFinding | null {
  const net = fieldNum(data, 'totalNetWeight');
  const gross = fieldNum(data, 'totalGrossWeight');
  if (net == null || gross == null) return null;
  return net <= gross + 0.001
    ? null
    : finding('totalGrossWeight', `peso líquido (${net}) maior que o bruto (${gross})`, 'warning');
}

/**
 * Quantidade de item do PL deve ser inteira (peças/pares). Quantidade decimal é
 * sinal clássico de valor monetário/preço lido na coluna errada (UAT Odett #8).
 */
function plQuantityIntegerCheck(data: Record<string, any>): HarnessFinding | null {
  const items = Array.isArray(data.items) ? data.items : [];
  for (let i = 0; i < items.length; i++) {
    const q = items[i]?.quantity?.value;
    if (typeof q === 'number' && Number.isFinite(q) && !Number.isInteger(q)) {
      return finding(
        `items[${i}].quantity`,
        `quantidade ${q} não é inteira — possível valor monetário lido como quantidade`,
        'warning',
      );
    }
  }
  return null;
}

const BL_VERIFICATION: VerificationConfig = {
  groundedFields: ['blNumber', 'customerReference', 'containerNumber'],
  containerFields: ['containerNumber'],
  dateFields: ['etd', 'eta', 'shipmentDate', 'issueDate'],
  ncmFields: ['ncmList'],
  portFields: PORTS,
};

const SKILLS: Record<string, ExtractionSkill> = {
  invoice: {
    type: 'invoice',
    label: 'Commercial Invoice',
    schema: invoiceResponseSchema,
    verification: {
      groundedFields: ['invoiceNumber', 'items[].itemCode'],
      ncmFields: ['items[].ncmCode'],
      dateFields: ['invoiceDate'],
      cnpjFields: ['importerCnpj'],
      usdCurrencyFields: ['currency'],
      portFields: PORTS,
      supplierFields: ['exporterName'],
      numericChecks: [invoiceTotalsCheck],
    },
  },
  packing_list: {
    type: 'packing_list',
    label: 'Packing List',
    schema: packingListResponseSchema,
    verification: {
      groundedFields: ['packingListNumber', 'invoiceNumber', 'items[].itemCode'],
      cnpjFields: ['importerCnpj'],
      dateFields: ['date'],
      portFields: PORTS,
      numericChecks: [netLeGrossCheck, plQuantityIntegerCheck],
    },
  },
  ohbl: {
    type: 'ohbl',
    label: 'BL Final (OHBL)',
    schema: blResponseSchema,
    verification: BL_VERIFICATION,
  },
  draft_bl: {
    type: 'draft_bl',
    label: 'Draft BL',
    schema: draftBLResponseSchema,
    verification: BL_VERIFICATION,
  },
};

export function getSkill(docType: string): ExtractionSkill | null {
  return SKILLS[docType] ?? null;
}

export function getVerificationConfig(docType: string): VerificationConfig | null {
  return SKILLS[docType]?.verification ?? null;
}
