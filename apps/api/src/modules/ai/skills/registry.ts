/**
 * Skill registry — maps a document type to its extraction skill. A skill is the
 * unit of specialization: it bundles the schema, the specialist domain rules,
 * gold few-shot examples, the RAG retrieval plan and the trust-harness recipe.
 * The AI service looks the skill up to assemble the prompt (skills/assemble.ts)
 * and to verify the extraction with the harness. Adding an entry here teaches
 * the model a new document type — see docs/IA-ESPECIALISTA.md.
 *
 * The per-document `domainRules` and `fewShot` below were authored and
 * adversarially verified field-by-field against each Zod schema by a specialist
 * team (2026-06-14); every fewShot parses against its schema (assemble.test.ts).
 */

import { invoiceResponseSchema } from '../schemas/invoice-response.js';
import { packingListResponseSchema } from '../schemas/packing-list-response.js';
import { blResponseSchema } from '../schemas/bl-response.js';
import { draftBLResponseSchema } from '../schemas/draft-bl-response.js';
import { proformaResponseSchema } from '../schemas/proforma-response.js';
import { espelhoResponseSchema } from '../schemas/espelho-response.js';
import { certificateResponseSchema } from '../schemas/certificate-response.js';
import { liResponseSchema } from '../schemas/li-response.js';
import { approxEqual, fieldNum, fieldVal, finding } from '../harness/numeric.js';
import { cbmCeilingForContainer, isKnownCarrier } from '../harness/premises.js';
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

/**
 * Σ(item.unitPrice × item.quantity) ≈ totalValue declarado na LI. A LI não traz
 * totalPrice por item (é licença, não fatura), então o valor por linha é
 * derivado de unitPrice × quantity quando o unitPrice está impresso.
 */
function liTotalsCheck(data: Record<string, any>): HarnessFinding | null {
  const total = fieldNum(data, 'totalValue');
  const items = Array.isArray(data.items) ? data.items : [];
  if (total == null || items.length === 0) return null;
  let sum = 0;
  let counted = false;
  for (const it of items) {
    const q = it?.quantity?.value;
    const up = it?.unitPrice?.value;
    if (
      typeof q === 'number' &&
      typeof up === 'number' &&
      Number.isFinite(q) &&
      Number.isFinite(up)
    ) {
      sum += q * up;
      counted = true;
    }
  }
  if (!counted) return null;
  return approxEqual(sum, total, 0.02)
    ? null
    : finding(
        'totalValue',
        `soma dos itens (${sum.toFixed(2)}) diverge do valor total declarado (${total.toFixed(2)})`,
        'warning',
      );
}

/** deferralDate (deferimento) nunca pode ser anterior ao registrationDate. */
function liDeferralAfterRegistrationCheck(data: Record<string, any>): HarnessFinding | null {
  const reg = data?.registrationDate?.value;
  const def = data?.deferralDate?.value;
  if (typeof reg !== 'string' || typeof def !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reg) || !/^\d{4}-\d{2}-\d{2}$/.test(def)) return null;
  return def >= reg
    ? null
    : finding(
        'deferralDate',
        `data de deferimento (${def}) anterior ao registro (${reg})`,
        'warning',
      );
}

/**
 * totalCbm não pode exceder a capacidade física do containerType (premissas
 * cbmByContainer). Regra DO NOSSO AMBIENTE: 40HQ ~76m³ real, 20GP ~33m³ real.
 * Flagga se totalCbm > teto 'real' + margem (default 5%). Degrada a null quando
 * não há containerType (ex.: draft_bl/espelho), tipo não tabelado (LCL/Aéreo)
 * ou KB ausente — nunca falso alarme.
 */
function cbmVsContainerCheck(data: Record<string, any>, marginPct = 0.05): HarnessFinding | null {
  const cbm = fieldNum(data, 'totalCbm');
  if (cbm == null || cbm <= 0) return null;
  const ctype = fieldVal(data, 'containerType');
  if (typeof ctype !== 'string' || !ctype.trim()) return null; // sem tipo: no-op
  const cap = cbmCeilingForContainer(ctype);
  if (!cap) return null; // tipo não tabelado / KB ausente: não refuta
  const ceiling = cap.ceiling * (1 + marginPct);
  return cbm <= ceiling
    ? null
    : finding(
        'totalCbm',
        `CBM ${cbm.toFixed(1)} excede a capacidade do ${ctype} ` +
          `(${cap.basis} ${cap.ceiling.toFixed(1)} m³ +${(marginPct * 100).toFixed(0)}% = ` +
          `${ceiling.toFixed(1)}) — confira containerType/totalCbm`,
        'warning',
      );
}

/**
 * shippingLine/carrier deve ser um armador conhecido do nosso ambiente
 * (carriers.json: HPL=Hapag-Lloyd, HMM, MOL, YML, MAERSK, MSC, ONE...).
 * Aceita sigla ou nome. Flagga se não reconhecido. Degrada se KB vazio.
 */
function carrierKnownCheck(data: Record<string, any>): HarnessFinding | null {
  const field =
    data.shippingLine != null
      ? 'shippingLine'
      : data.carrier != null
        ? 'carrier'
        : data.shippingline != null
          ? 'shippingline'
          : null;
  if (!field) return null;
  const v = fieldVal(data, field);
  if (typeof v !== 'string' || !v.trim()) return null;
  return isKnownCarrier(v)
    ? null
    : finding(
        field,
        `armador "${v}" não reconhecido na lista de shipping lines do ambiente ` +
          `(carriers.json) — confira a grafia ou cadastre`,
        'warning',
      );
}

// ════════════════════════════════════════════════════════════════════
// Specialist content (domainRules + gold few-shot) per document type.
// ════════════════════════════════════════════════════════════════════

// ── Invoice ──────────────────────────────────────────────────────────
const INVOICE_DOMAIN_RULES = `Documento: Commercial Invoice (fatura comercial do fornecedor estrangeiro).
- invoiceNumber: nº da fatura no topo ("Invoice No."). invoiceDate: data de EMISSÃO (não a de embarque).
- exporter*: o vendedor/shipper estrangeiro (China, Índia, Bangladesh, Hong Kong, Paraguai... — não assuma China). importer*: o comprador brasileiro (ex.: Puket/Imaginarium/Grupo Uni.co); importerCnpj com 14 dígitos.
- incoterm: FOB/CFR/CIF/EXW. currency: quase sempre USD.
- items[]: cada linha é um SKU. itemCode é o código do produto — CUIDADO com letra de outra coluna colada no código (ex.: "W7765Y" vindo de "WHITE BOX" deve ser "7765Y"). quantity é INTEIRA (peças/pares); unitPrice × quantity = totalPrice. ncmCode com 8 dígitos. ean só se impresso (8/12/13/14 díg).
- isFreeOfCharge=true em amostra/FOC/brinde: esses itens NÃO entram no totalFobValue.
- totalFobValue = soma dos totalPrice dos itens NÃO-FOC; deve bater com o total declarado. Pesos: líquido <= bruto.`;

const INVOICE_FEWSHOT = `{
  "invoiceNumber": { "value": "INV-2026-0042", "confidence": 0.98 },
  "invoiceDate": { "value": "2026-03-14", "confidence": 0.95 },
  "exporterName": { "value": "ODETT TOYS CO., LTD", "confidence": 0.97 },
  "exporterAddress": { "value": "NINGBO, CHINA", "confidence": 0.9 },
  "importerName": { "value": "PUKET MEIAS S.A.", "confidence": 0.96 },
  "importerAddress": { "value": "SAO PAULO, BRASIL", "confidence": 0.9 },
  "importerCnpj": { "value": "11222333000181", "confidence": 0.93 },
  "incoterm": { "value": "FOB", "confidence": 0.99 },
  "currency": { "value": "USD", "confidence": 0.99 },
  "portOfLoading": { "value": "NINGBO", "confidence": 0.95 },
  "portOfDischarge": { "value": "SANTOS", "confidence": 0.95 },
  "items": [
    { "itemCode": { "value": "7765Y", "confidence": 0.94 }, "description": { "value": "MEIA INFANTIL", "confidence": 0.92 }, "quantity": { "value": 1200, "confidence": 0.95 }, "unitPrice": { "value": 0.85, "confidence": 0.95 }, "totalPrice": { "value": 1020, "confidence": 0.95 }, "ncmCode": { "value": "61159500", "confidence": 0.9 }, "isFreeOfCharge": { "value": false, "confidence": 0.99 } },
    { "itemCode": { "value": "SAMPLE-01", "confidence": 0.8 }, "description": { "value": "AMOSTRA SEM VALOR COMERCIAL", "confidence": 0.85 }, "quantity": { "value": 10, "confidence": 0.9 }, "unitPrice": { "value": 0, "confidence": 0.9 }, "totalPrice": { "value": 0, "confidence": 0.9 }, "isFreeOfCharge": { "value": true, "confidence": 0.97 } }
  ],
  "totalFobValue": { "value": 1020, "confidence": 0.95 }
}`;

// ── Packing List ─────────────────────────────────────────────────────
const PL_DOMAIN_RULES = `Documento: Packing List / Romaneio de embarque (acompanha a Commercial Invoice; fornecedor estrangeiro — China, Índia, Bangladesh, Hong Kong, Paraguai... -> importador BR Puket/Imaginarium/Grupo Uni.co). NUNCA contém preço/valor monetário — só unidades, caixas (cartons) e pesos.
- packingListNumber: nº do PL no topo ("Packing List No.", "P/L No."). Pode coincidir com o invoiceNumber — ainda assim grounde no texto, não invente.
- invoiceNumber (opcional): nº da Commercial Invoice referenciada.
- date: data do PL em ISO 8601. Prefira a data de EMISSÃO; não confunda com embarque/ETD. Atenção a BR (DD/MM) vs intl (MM/DD).
- exporterName: vendedor/shipper estrangeiro. importerName: comprador BR. NÃO troque os dois.
- items[]: cada linha = 1 SKU.
  - itemCode: SÓ o código real (ex.: PI7752Y). PEGADINHA: prefixo de OUTRA coluna colado — embalagem ("WHITE BOX"->W, "POLYBAG", "GIFT BOX"), coleção ("FALL/24"), marca. Se TODOS começam com a MESMA letra isolada, é ruído da coluna vizinha — remova.
  - ean (opcional): só se impresso (colunas EAN/BARCODE/GTIN/UPC). NUNCA invente nem calcule dígito. Sem barcode -> null.
  - quantity: unidades (PCS/PAR) — INTEIRO. Quantidade decimal é sinal de valor monetário lido na coluna errada — PL não tem preço.
  - boxQuantity: nº de caixas daquele item (INTEIRO). netWeight/grossWeight em KG; netWeight <= grossWeight por item.
- totalBoxes: INTEIRO de caixas/cartons/volumes. NUNCA confundir com CBM. totalCbm: m³ DECIMAL. totalNetWeight <= totalGrossWeight (KG). Idealmente Σ por item ≈ totais.
- Decimal: ponto. "1.234,50" -> 1234.50. Campo ausente -> {value:null, confidence:0}. Extraia TODOS os itens.`;

const PL_FEWSHOT = `{
  "packingListNumber": { "value": "PL-2026-0042", "confidence": 0.97 },
  "invoiceNumber": { "value": "INV-2026-0042", "confidence": 0.95 },
  "date": { "value": "2026-03-14", "confidence": 0.93 },
  "exporterName": { "value": "KIOM INDUSTRY CO., LTD", "confidence": 0.96 },
  "importerName": { "value": "PUKET MEIAS S.A.", "confidence": 0.95 },
  "items": [
    { "itemCode": { "value": "PI7752Y", "confidence": 0.93 }, "ean": { "value": "7909692093303", "confidence": 0.9 }, "description": { "value": "MEIA INFANTIL", "confidence": 0.92 }, "color": { "value": "WHITE", "confidence": 0.88 }, "size": { "value": "34-39", "confidence": 0.85 }, "quantity": { "value": 1200, "confidence": 0.94 }, "boxQuantity": { "value": 40, "confidence": 0.92 }, "netWeight": { "value": 180.5, "confidence": 0.9 }, "grossWeight": { "value": 200.0, "confidence": 0.9 } },
    { "itemCode": { "value": "AC2285Y", "confidence": 0.91 }, "ean": { "value": null, "confidence": 0.0 }, "description": { "value": "ACESSORIO CABELO", "confidence": 0.9 }, "color": { "value": "PINK", "confidence": 0.86 }, "size": { "value": "UNICO", "confidence": 0.8 }, "quantity": { "value": 600, "confidence": 0.93 }, "boxQuantity": { "value": 20, "confidence": 0.91 }, "netWeight": { "value": 90.0, "confidence": 0.89 }, "grossWeight": { "value": 100.0, "confidence": 0.89 } }
  ],
  "totalBoxes": { "value": 60, "confidence": 0.95 },
  "totalNetWeight": { "value": 270.5, "confidence": 0.92 },
  "totalGrossWeight": { "value": 300.0, "confidence": 0.92 },
  "totalCbm": { "value": 4.85, "confidence": 0.9 }
}`;

// ── BL (OHBL e Draft) — regras compartilhadas + exemplos próprios ─────
const BL_DOMAIN_RULES = `Conhecimento de embarque (Bill of Lading). Importador: Grupo Uni.co (Puket/Imaginarium); fornecedores asiáticos; descarga típica Santos (também Navegantes/Itapoá/Itajaí); moeda USD.
PARTES (não troque papéis): shipper = EXPORTADOR/embarcador estrangeiro. consignee = destinatário (Grupo Uni.co / UNI.CO COMERCIO S/A / IMB TEXTIL / "TO ORDER"). notifyParty = avisado na chegada (muitas vezes "SAME AS CONSIGNEE"; copie o texto).
IDENTIFICADORES: blNumber = nº do conhecimento (cabeçalho, "B/L No."). customerReference = ref do CLIENTE/processo ("ORDER NO.", "PO", "BOOKING REF"; ex.: "ORDER NO.: IM0712602NB" -> "IM0712602NB"). NUNCA copie o blNumber em customerReference.
NAVIO: vesselName só o nome. Se "VESSEL/VOYAGE" colado ("COSCO SHIPPING ARGENTINA/0BDNIW1MA"), separe vesselName e voyageNumber.
PORTOS: portOfLoading = embarque (Ásia). portOfDischarge = descarga (Brasil). Não troque; Place of Receipt/Delivery NÃO são os portos marítimos.
DATAS (ISO 8601): shipmentDate = "Shipped on Board". issueDate = "Date of Issue" (no OHBL quase sempre existe; é o que distingue do draft). eta >= etd; issueDate normalmente >= shipmentDate.
CONTAINER: containerNumber = ISO 6346 (4 letras + 7 dígitos; 4º char U/J/Z; 11º é DÍGITO VERIFICADOR mod-11 — o harness valida, não fabrique). Vários -> separe por vírgula. sealNumber é o lacre (formato livre, distinto). containerType: "40HQ"/"20GP"/"LCL".
PESOS/FRETE (decimal internacional, "12,345.67" = 12345.67): totalGrossWeight (KG), totalCbm (m³; 40HQ ~ até ~68), totalBoxes inteiro. freightValue/freightCurrency: se "PREPAID"/"COLLECT", freightValue=null e freightCurrency recebe o texto.
woodDeclaration: true se qualquer menção a madeira/wood/pallet/ISPM15/fumigation. ncmList: TODOS os NCM impressos (8 dígitos). freeTime: dias de free time, ou null. Campo ausente -> {value:null, confidence:0}.`;

const OHBL_FEWSHOT = `{
  "blNumber": { "value": "SHYY26021495A", "confidence": 0.97 },
  "customerReference": { "value": "IM0712602NB", "confidence": 0.93 },
  "shipper": { "value": "KIOM INDUSTRY CO., LTD", "confidence": 0.95 },
  "consignee": { "value": "UNI.CO COMERCIO S/A", "confidence": 0.94 },
  "notifyParty": { "value": "SAME AS CONSIGNEE", "confidence": 0.9 },
  "vesselName": { "value": "COSCO SHIPPING ARGENTINA", "confidence": 0.95 },
  "voyageNumber": { "value": "0BDNIW1MA", "confidence": 0.93 },
  "portOfLoading": { "value": "NINGBO, CHINA", "confidence": 0.96 },
  "portOfDischarge": { "value": "SANTOS, BRAZIL", "confidence": 0.96 },
  "etd": { "value": "2026-03-02", "confidence": 0.85 },
  "eta": { "value": "2026-04-10", "confidence": 0.85 },
  "shipmentDate": { "value": "2026-03-02", "confidence": 0.92 },
  "issueDate": { "value": "2026-03-05", "confidence": 0.93 },
  "containerNumber": { "value": "TCLU1234568", "confidence": 0.95 },
  "sealNumber": { "value": "CN8853471", "confidence": 0.9 },
  "totalBoxes": { "value": 1280, "confidence": 0.9 },
  "totalGrossWeight": { "value": 8450.5, "confidence": 0.9 },
  "totalCbm": { "value": 58.2, "confidence": 0.9 },
  "freightValue": { "value": null, "confidence": 0.9 },
  "freightCurrency": { "value": "PREPAID", "confidence": 0.92 },
  "containerType": { "value": "40HQ", "confidence": 0.93 },
  "cargoDescription": { "value": "CHILDREN SOCKS AND TOYS PACKED IN CARTONS ON WOODEN PALLETS (ISPM15 HEAT TREATED)", "confidence": 0.9 },
  "freeTime": { "value": 21, "confidence": 0.85 },
  "woodDeclaration": { "value": true, "confidence": 0.95 },
  "ncmList": { "value": ["6115.95.00", "9503.00.99"], "confidence": 0.88 }
}`;

const DRAFT_BL_FEWSHOT = `{
  "blNumber": { "value": "SHYY26021495A", "confidence": 0.96 },
  "customerReference": { "value": "IM0712602NB", "confidence": 0.9 },
  "shipper": { "value": "KIOM INDUSTRY CO., LTD", "confidence": 0.95 },
  "consignee": { "value": "UNI.CO COMERCIO S/A", "confidence": 0.93 },
  "notifyParty": { "value": "SAME AS CONSIGNEE", "confidence": 0.88 },
  "vesselName": { "value": "COSCO SHIPPING ARGENTINA", "confidence": 0.94 },
  "voyageNumber": { "value": "0BDNIW1MA", "confidence": 0.94 },
  "portOfLoading": { "value": "NINGBO, CHINA", "confidence": 0.96 },
  "portOfDischarge": { "value": "SANTOS, BRAZIL", "confidence": 0.96 },
  "etd": { "value": "2026-05-18", "confidence": 0.9 },
  "eta": { "value": "2026-06-25", "confidence": 0.9 },
  "shipmentDate": { "value": "2026-05-18", "confidence": 0.92 },
  "issueDate": { "value": "2026-05-19", "confidence": 0.85 },
  "containerNumber": { "value": "TCLU1234568", "confidence": 0.95 },
  "sealNumber": { "value": "CN9987654", "confidence": 0.9 },
  "totalBoxes": { "value": 1280, "confidence": 0.93 },
  "totalGrossWeight": { "value": 12345.67, "confidence": 0.9 },
  "totalCbm": { "value": 58.4, "confidence": 0.9 },
  "freightValue": { "value": null, "confidence": 0.0 },
  "freightCurrency": { "value": "PREPAID", "confidence": 0.95 },
  "cargoDescription": { "value": "100% COTTON KNITTED SOCKS / CHILDREN GARMENTS - WOODEN PACKING ISPM-15 TREATED", "confidence": 0.9 },
  "freeTime": { "value": 21, "confidence": 0.88 },
  "woodDeclaration": { "value": true, "confidence": 0.92 },
  "ncmList": { "value": ["6115.95.00", "6111.20.00"], "confidence": 0.86 }
}`;

const BL_VERIFICATION_BASE: VerificationConfig = {
  groundedFields: ['blNumber', 'customerReference', 'containerNumber'],
  ncmFields: ['ncmList'],
  dateFields: ['etd', 'eta', 'shipmentDate', 'issueDate'],
  containerFields: ['containerNumber'],
  supplierFields: ['shipper'],
  portFields: PORTS,
};

// ── Proforma Invoice ─────────────────────────────────────────────────
const PROFORMA_DOMAIN_RULES = `Documento: Proforma Invoice (estimativa PRÉ-EMBARQUE do fornecedor; valores ainda podem mudar antes da Commercial Invoice). Só é Proforma se o título trouxer "PROFORMA INVOICE" ou o número começar com PI+dígitos; se for Commercial Invoice definitiva, é misclassificação -> retorne tudo null/0.
- piNumber: número da Proforma (ex.: PIK10056) — CHAVE de ligação com a planilha Pre-Cons; sempre extrair. invoiceNumber (opcional) SÓ se houver um "Invoice No." SEPARADO impresso; não duplique o piNumber.
- invoiceDate: emissão (não embarque/ETD nem validade). validUntil: validade da cotação. Ambas ISO 8601.
- exporter*: vendedor estrangeiro; exporterTaxId é registro fiscal estrangeiro (não CNPJ). importer*: comprador BR (Puket/Imaginarium/IMB TEXTIL); importerCnpj 14 dígitos.
- incoterm: FOB/CFR/CIF/EXW. currency: ISO 4217, quase sempre USD. portOfLoading no exterior. portOfDischarge no Brasil: predominam portos de Santa Catarina (Navegantes/Itajaí/Itapoá/Imbituba); também Santos/Paranaguá e aéreo (Guarulhos/Navegantes). NÃO assuma Santos por padrão — leia o documento.
- items[]: itemCode = código do produto (cuidado com letra de outra coluna; "W7765Y" -> 7765Y, cor WHITE vai em color). quantity INTEIRA. unitPrice × quantity = totalPrice. ncmCode 8 dígitos. unitType (PCS/PAIR/SET/CTN).
- isFreeOfCharge=true quando unitPrice=0 ou "FOC"/"amostra"/"brinde"; itens FOC NÃO entram em totalFobValue.
- totalFobValue = soma dos totalPrice NÃO-FOC. paymentTerms = {depositPercent, balancePercent, paymentDays, description}. totalNetWeight <= totalGrossWeight; totalBoxes inteiro.`;

const PROFORMA_FEWSHOT = `{
  "piNumber": { "value": "PIK10056", "confidence": 0.98 },
  "invoiceDate": { "value": "2026-03-14", "confidence": 0.95 },
  "validUntil": { "value": "2026-04-14", "confidence": 0.9 },
  "exporterName": { "value": "KIOM INDUSTRY CO., LTD", "confidence": 0.97 },
  "exporterAddress": { "value": "NINGBO, CHINA", "confidence": 0.9 },
  "exporterTaxId": { "value": "91330200MA2GXXXX1A", "confidence": 0.8 },
  "importerName": { "value": "PUKET MEIAS S.A.", "confidence": 0.96 },
  "importerAddress": { "value": "SAO PAULO, BRASIL", "confidence": 0.9 },
  "importerCnpj": { "value": "11222333000181", "confidence": 0.93 },
  "incoterm": { "value": "FOB", "confidence": 0.99 },
  "currency": { "value": "USD", "confidence": 0.99 },
  "portOfLoading": { "value": "NINGBO", "confidence": 0.95 },
  "portOfDischarge": { "value": "SANTOS", "confidence": 0.95 },
  "items": [
    { "itemCode": { "value": "7765Y", "confidence": 0.94 }, "description": { "value": "MEIA INFANTIL", "confidence": 0.92 }, "color": { "value": "WHITE", "confidence": 0.9 }, "size": { "value": "M", "confidence": 0.85 }, "quantity": { "value": 1200, "confidence": 0.95 }, "unitPrice": { "value": 0.85, "confidence": 0.95 }, "totalPrice": { "value": 1020, "confidence": 0.95 }, "ncmCode": { "value": "61159500", "confidence": 0.9 }, "unitType": { "value": "PAIR", "confidence": 0.85 }, "isFreeOfCharge": { "value": false, "confidence": 0.99 } },
    { "itemCode": { "value": "SAMPLE-01", "confidence": 0.8 }, "description": { "value": "AMOSTRA SEM VALOR COMERCIAL", "confidence": 0.85 }, "quantity": { "value": 10, "confidence": 0.9 }, "unitPrice": { "value": 0, "confidence": 0.9 }, "totalPrice": { "value": 0, "confidence": 0.9 }, "isFreeOfCharge": { "value": true, "confidence": 0.97 } }
  ],
  "paymentTerms": { "value": { "depositPercent": 30, "balancePercent": 70, "paymentDays": null, "description": "30% DEPOSIT / 70% BALANCE BEFORE SHIPMENT" }, "confidence": 0.9 },
  "totalFobValue": { "value": 1020, "confidence": 0.95 },
  "totalBoxes": { "value": 40, "confidence": 0.9 },
  "totalNetWeight": { "value": 180.5, "confidence": 0.88 },
  "totalGrossWeight": { "value": 210, "confidence": 0.88 },
  "totalCbm": { "value": 1.85, "confidence": 0.85 }
}`;

// ── Espelho / Pre-Cons ───────────────────────────────────────────────
const ESPELHO_DOMAIN_RULES = `Documento: Espelho / Pre-Cons (planilha xlsx que CONSOLIDA um embarque para a parte aduaneira — Puket e Imaginarium). Cabeçalho (Importador, Shipping line, totais) + tabela de itens. Moeda SEMPRE USD; pesos em kg; volume em m³.
CABEÇALHO (top-level, opcionais): importerName/importerCnpj/importerAddress = IMPORTADOR brasileiro (UNI.CO COMERCIO S/A, PUKET); importerCnpj 14 dígitos só dígitos. NÃO confunda com o fornecedor estrangeiro. shippingLine = armador (MAERSK/MSC/COSCO/HAPAG-LLOYD/ONE/EVERGREEN/CMA CGM; siglas HPL/HMM/MOL). totalNetWeight <= totalGrossWeight SEMPRE. totalCbm pequeno (10-70/container; >100 suspeito). totalAmountUsd = total do embarque.
ITENS (items[] obrigatório; codigo+descricao obrigatórios): codigo padrão Uni.co = 2-4 letras + 4-6 dígitos + opc. 1 letra (PI7752Y, IM10604). NÃO concatene COLEÇÃO/SEASON/COLOR ao código ("SS26 PI7752Y" -> "PI7752Y"). ncm = STRING 8 dígitos. qty = inteiro (decimal = valor monetário lido errado). unitPrice/amountUsd em USD; unitPrice × qty ~= amountUsd. Decimal BR: "1.234,56" = 1234.56. caixasPorRef inteiro. pesoLiquidoTotal <= pesoBrutoTotal por item.
COERÊNCIA: Σ(amountUsd)~=totalAmountUsd; Σ(caixasPorRef)~=totalBoxes; Σ(pesoBrutoTotal)~=totalGrossWeight; Σ(pesoLiquidoTotal)~=totalNetWeight. Campo ausente -> {value:null, confidence:0}. Não invente.`;

const ESPELHO_FEWSHOT = `{
  "totalBoxes": { "value": 57, "confidence": 0.96 },
  "totalNetWeight": { "value": 228.0, "confidence": 0.93 },
  "totalGrossWeight": { "value": 250.5, "confidence": 0.93 },
  "totalCbm": { "value": 18.4, "confidence": 0.9 },
  "totalAmountUsd": { "value": 1965, "confidence": 0.95 },
  "shippingLine": { "value": "MAERSK", "confidence": 0.94 },
  "importerName": { "value": "UNI.CO COMERCIO S/A", "confidence": 0.96 },
  "importerCnpj": { "value": "11222333000181", "confidence": 0.92 },
  "importerAddress": { "value": "SAO PAULO, SP, BRASIL", "confidence": 0.88 },
  "items": [
    { "codigo": { "value": "PI7752Y", "confidence": 0.94 }, "descricao": { "value": "MEIA INFANTIL PUKET", "confidence": 0.92 }, "ncm": { "value": "61159500", "confidence": 0.9 }, "qty": { "value": 1200, "confidence": 0.95 }, "unitPrice": { "value": 0.85, "confidence": 0.94 }, "amountUsd": { "value": 1020, "confidence": 0.95 }, "caixasPorRef": { "value": 30, "confidence": 0.93 }, "pesoLiquidoTotal": { "value": 120.0, "confidence": 0.9 }, "pesoBrutoTotal": { "value": 132.5, "confidence": 0.9 } },
    { "codigo": { "value": "AC2285Y", "confidence": 0.93 }, "descricao": { "value": "CADERNO IMAGINARIUM", "confidence": 0.9 }, "ncm": { "value": "48201000", "confidence": 0.88 }, "qty": { "value": 900, "confidence": 0.94 }, "unitPrice": { "value": 1.05, "confidence": 0.92 }, "amountUsd": { "value": 945, "confidence": 0.94 }, "caixasPorRef": { "value": 27, "confidence": 0.92 }, "pesoLiquidoTotal": { "value": 108.0, "confidence": 0.9 }, "pesoBrutoTotal": { "value": 118.0, "confidence": 0.9 } }
  ]
}`;

// ── Certificado ──────────────────────────────────────────────────────
const CERT_DOMAIN_RULES = `Documento: Certificado de importação (Origem/CO, INMETRO, Qualidade/SGS/ISO, Fitossanitário, Fumigação/ISPM-15, Radiação/ANVISA). Não é fatura nem BL; se não for certificado, retorne tudo null/0.
- certificateType: normalize para um de "origin"/"inmetro"/"quality"/"phytosanitary"/"fumigation"/"radiation"/"other" — semântico, deduza pelo título/órgão, não copie o texto cru.
- certificateNumber: nº/serial ("Certificate No."). Copie LITERAL; cuidado com prefixo de outra coluna ("FORM E 23C..." -> "23C...").
- issuingAuthority: órgão emissor (CCPIT, SGS, Bureau Veritas, INMETRO/OCP, AQSIQ). É QUEM EMITE — não confunda com exporterName nem importerName.
- issueDate = emissão/assinatura (não embarque). expirationDate = validade; muitos (CO, fitossanitário, fumigação) NÃO têm validade -> null. expirationDate >= issueDate. Ambas ISO 8601.
- exporterName = exportador/produtor estrangeiro. importerName = comprador BR (Puket/Imaginarium/Uni.co). countryOfOrigin = país (não cidade/porto). invoiceReference = nº da Commercial Invoice citada (chave de cruzamento).
- items[]: description, itemCode (literal), ncmCode 8 dígitos, quantity INTEIRA. observations: notas livres. Campo ausente -> {value:null, confidence:0}. Não invente.`;

const CERT_FEWSHOT = `{
  "certificateType": { "value": "origin", "confidence": 0.97 },
  "certificateNumber": { "value": "23C3301000123", "confidence": 0.94 },
  "issuingAuthority": { "value": "CCPIT - CHINA COUNCIL FOR THE PROMOTION OF INTERNATIONAL TRADE", "confidence": 0.93 },
  "issueDate": { "value": "2026-03-15", "confidence": 0.95 },
  "expirationDate": { "value": null, "confidence": 0 },
  "exporterName": { "value": "ODETT TOYS CO., LTD", "confidence": 0.96 },
  "importerName": { "value": "UNI.CO COMERCIO S/A", "confidence": 0.92 },
  "countryOfOrigin": { "value": "CHINA", "confidence": 0.97 },
  "invoiceReference": { "value": "INV-2026-0042", "confidence": 0.9 },
  "items": [
    { "description": { "value": "MEIA INFANTIL", "confidence": 0.9 }, "itemCode": { "value": "7765Y", "confidence": 0.88 }, "ncmCode": { "value": "61159500", "confidence": 0.85 }, "quantity": { "value": 1200, "confidence": 0.9 } },
    { "description": { "value": "BONECO DE PELUCIA", "confidence": 0.89 }, "itemCode": { "value": "9032A", "confidence": 0.87 }, "ncmCode": { "value": "95030099", "confidence": 0.84 }, "quantity": { "value": 500, "confidence": 0.9 } }
  ],
  "observations": { "value": null, "confidence": 0 }
}`;

// ── Licença de Importação (LI / Siscomex) ────────────────────────────
const LI_DOMAIN_RULES = `Documento: Licença de Importação (LI) — licença administrativa registrada no Siscomex (Portal Único / módulo LI ou LPCO). É um ATO DE GOVERNO, não uma fatura nem um BL; se o documento for invoice/BL/certificado, é misclassificação -> retorne tudo null/0. A LI autoriza a importação por NCM e é deferida pelos órgãos ANUENTES.
- liNumber: nº da LI no Siscomex ("LI nº", "Licença de Importação", normalmente AA/NNNNNNN-D, ex.: 26/1234567-8). Copie LITERAL; é a chave do processo. Não confunda com o nº da DI/DUIMP nem com o nº da invoice.
- registrationDate: data de REGISTRO da LI (quando foi registrada no Siscomex). deferralDate: data de DEFERIMENTO (quando o(s) anuente(s) deferiram/aprovaram). Ambas ISO 8601 (YYYY-MM-DD). deferralDate >= registrationDate; LI ainda não deferida -> deferralDate null.
- status: situação da LI. Normalize para um de "pending"/"requested"/"submitted"/"deferred"/"expired"/"cancelled" (enum li_status). "EM ANÁLISE"/"AGUARDANDO" -> "submitted"; "DEFERIDA"/"DEFERIDO" -> "deferred"; "INDEFERIDA"/"CANCELADA" -> "cancelled"; "VENCIDA"/"EXPIRADA" -> "expired".
- importerName: IMPORTADOR brasileiro (UNI.CO COMERCIO S/A, PUKET, Imaginarium). importerCnpj: 14 dígitos, só números, com dígitos verificadores VÁLIDOS (o harness valida — não fabrique). exporterName: exportador/fabricante estrangeiro (China, Índia, Bangladesh...). NÃO troque importador e exportador.
- items[]: cada linha = um destaque/adição por NCM. ncmCode 8 dígitos (formato XXXX.XX.XX). description = descrição da mercadoria. quantity = quantidade na unidade estatística (INTEIRA quando peças/pares). unitPrice (opcional) só se impresso por item; a LI muitas vezes traz só o valor total.
- totalValue: valor total declarado da licença (condição VMLE/VMLD ou valor aduaneiro). currency: ISO 4217, quase sempre USD em importação internacional. incoterm (opcional): FOB/CFR/CIF/EXW se constar.
- anuentes: lista dos ÓRGÃOS ANUENTES que deferem a LI (ex.: "INMETRO", "ANVISA", "DECEX", "MAPA", "IBAMA", "Polícia Federal", "Exército", "ANEEL"). Liste os nomes como aparecem; sem anuente explícito -> null. NÃO invente órgão.
- Campo ausente -> {value:null, confidence:0}. Extraia TODOS os itens. Não invente dados não impressos.`;

const LI_FEWSHOT = `{
  "liNumber": { "value": "26/1234567-8", "confidence": 0.97 },
  "registrationDate": { "value": "2026-03-10", "confidence": 0.95 },
  "deferralDate": { "value": "2026-03-18", "confidence": 0.92 },
  "status": { "value": "deferred", "confidence": 0.95 },
  "importerName": { "value": "UNI.CO COMERCIO S/A", "confidence": 0.96 },
  "importerCnpj": { "value": "11222333000181", "confidence": 0.93 },
  "exporterName": { "value": "ZHUJI QINGTAI SOCKS CO., LTD.", "confidence": 0.94 },
  "items": [
    { "ncmCode": { "value": "61159500", "confidence": 0.9 }, "description": { "value": "MEIA INFANTIL DE ALGODAO", "confidence": 0.92 }, "quantity": { "value": 1200, "confidence": 0.94 }, "unitPrice": { "value": 0.85, "confidence": 0.9 } },
    { "ncmCode": { "value": "95030099", "confidence": 0.88 }, "description": { "value": "BRINQUEDO DE PELUCIA", "confidence": 0.9 }, "quantity": { "value": 500, "confidence": 0.93 }, "unitPrice": { "value": 1.10, "confidence": 0.89 } }
  ],
  "totalValue": { "value": 1570, "confidence": 0.94 },
  "currency": { "value": "USD", "confidence": 0.99 },
  "incoterm": { "value": "FOB", "confidence": 0.95 },
  "anuentes": { "value": ["INMETRO", "DECEX"], "confidence": 0.88 }
}`;

const SKILLS: Record<string, ExtractionSkill> = {
  invoice: {
    type: 'invoice',
    label: 'Commercial Invoice',
    schema: invoiceResponseSchema,
    domainRules: INVOICE_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'Invoice FOB/USD com 1 item comercial + 1 amostra FOC; total = só o item comercial (1020), itemCode sem prefixo de letra, NCM 8 díg, datas ISO.',
        json: INVOICE_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ports', 'ncms'], k: 5 },
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
    domainRules: PL_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'PL FOB China->Santos, 2 itens: itemCode sem prefixo de embalagem, quantity INTEIRA, ean só quando impresso (item 2 null), totalBoxes inteiro vs totalCbm decimal, Σ pesos batendo, net<=gross, data ISO.',
        json: PL_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ports', 'ean'], k: 4 },
    verification: {
      // FIX: schema do PL NÃO tem importerCnpj nem portOfLoading/Discharge — a
      // config antiga (cnpjFields/portFields) apontava p/ campos inexistentes.
      groundedFields: [
        'packingListNumber',
        'invoiceNumber',
        'exporterName',
        'importerName',
        'items[].itemCode',
        'items[].ean',
      ],
      dateFields: ['date'],
      supplierFields: ['exporterName'],
      numericChecks: [netLeGrossCheck, plQuantityIntegerCheck],
    },
  },
  ohbl: {
    type: 'ohbl',
    label: 'BL Final (OHBL)',
    schema: blResponseSchema,
    domainRules: BL_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'OHBL FOB/USD: vessel/voyage separados, ORDER NO.->customerReference (≠ blNumber), container ISO6346 com check digit VÁLIDO (TCLU1234568), madeira->woodDeclaration true, frete PREPAID->freightValue null, loading estrangeiro/discharge BR, issueDate>=shipmentDate, NCM 8 díg.',
        json: OHBL_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ports', 'carriers', 'ncms'], k: 5 },
    verification: { ...BL_VERIFICATION_BASE, numericChecks: [cbmVsContainerCheck] },
  },
  draft_bl: {
    type: 'draft_bl',
    label: 'Draft BL',
    schema: draftBLResponseSchema,
    domainRules: BL_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'Draft BL FCL 40HQ NINGBO->SANTOS, frete PREPAID, madeira ISPM-15: split VESSEL/VOYAGE, ORDER NO.->customerReference, container ISO6346 válido (TCLU1234568) ≠ lacre, NCM 8 díg, datas ISO coerentes.',
        json: DRAFT_BL_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ports', 'carriers', 'ncms'], k: 5 },
    verification: {
      ...BL_VERIFICATION_BASE,
      groundedFields: ['blNumber', 'customerReference', 'containerNumber', 'sealNumber'],
      numericChecks: [cbmVsContainerCheck],
    },
  },
  proforma_invoice: {
    type: 'proforma_invoice',
    label: 'Proforma Invoice',
    schema: proformaResponseSchema,
    domainRules: PROFORMA_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'Proforma FOB/USD KIOM->Santos, 1 item comercial + 1 amostra FOC: itemCode 7765Y sem prefixo de cor, total FOB = só comercial (1020), paymentTerms 30/70, NCM 8 díg, net<=gross. invoiceNumber ausente (não duplica o piNumber).',
        json: PROFORMA_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ports', 'ncms', 'premissas'], k: 5 },
    verification: {
      groundedFields: ['piNumber', 'invoiceNumber', 'items[].itemCode'],
      ncmFields: ['items[].ncmCode'],
      dateFields: ['invoiceDate', 'validUntil'],
      cnpjFields: ['importerCnpj'],
      usdCurrencyFields: ['currency'],
      supplierFields: ['exporterName'],
      portFields: PORTS,
      numericChecks: [invoiceTotalsCheck, netLeGrossCheck, plQuantityIntegerCheck],
    },
  },
  espelho: {
    type: 'espelho',
    label: 'Espelho / Pre-Cons',
    schema: espelhoResponseSchema,
    domainRules: ESPELHO_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'Espelho consolidado USD, 2 itens: codigo limpo (remove prefixo de COLEÇÃO/sufixo de cor), NCM string 8 díg, qty inteira, e somas batendo (amountUsd/caixas/pesos), peso líquido<=bruto.',
        json: ESPELHO_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'carriers', 'ncms', 'premissas'], k: 5 },
    verification: {
      groundedFields: ['importerName', 'shippingLine', 'items[].codigo'],
      ncmFields: ['items[].ncm'],
      cnpjFields: ['importerCnpj'],
      // qty (não 'quantity') -> plQuantityIntegerCheck não se aplica aqui.
      numericChecks: [netLeGrossCheck, carrierKnownCheck],
    },
  },
  certificate: {
    type: 'certificate',
    label: 'Certificado',
    schema: certificateResponseSchema,
    domainRules: CERT_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'Certificate of Origin (FORM E) chinês, sem validade (expirationDate null), número sem o prefixo "FORM E" colado, issuingAuthority (CCPIT) ≠ exporter, countryOfOrigin como país, itens com NCM 8 díg e quantity inteira.',
        json: CERT_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['parties', 'ncms'], k: 4 },
    verification: {
      groundedFields: ['certificateNumber', 'invoiceReference', 'items[].itemCode'],
      ncmFields: ['items[].ncmCode'],
      dateFields: ['issueDate', 'expirationDate'],
      supplierFields: ['exporterName'],
      numericChecks: [plQuantityIntegerCheck],
    },
  },
  li: {
    type: 'li',
    label: 'Licença de Importação (LI)',
    schema: liResponseSchema,
    domainRules: LI_DOMAIN_RULES,
    fewShot: [
      {
        description:
          'LI Siscomex DEFERIDA (status normalizado), deferimento >= registro, importador BR com CNPJ válido, 2 itens por NCM 8 díg (catálogo conhecido), valor total = Σ(unitPrice×qty)=1570, moeda USD, anuentes INMETRO/DECEX, datas ISO.',
        json: LI_FEWSHOT,
      },
    ],
    retrieval: { namespaces: ['ncms', 'parties', 'premissas'], k: 5 },
    verification: {
      groundedFields: ['liNumber', 'importerName', 'exporterName', 'items[].ncmCode'],
      ncmFields: ['items[].ncmCode'],
      dateFields: ['registrationDate', 'deferralDate'],
      cnpjFields: ['importerCnpj'],
      usdCurrencyFields: ['currency'],
      supplierFields: ['exporterName'],
      numericChecks: [liTotalsCheck, liDeferralAfterRegistrationCheck, plQuantityIntegerCheck],
    },
  },
};

export function getSkill(docType: string): ExtractionSkill | null {
  return SKILLS[docType] ?? null;
}

export function getVerificationConfig(docType: string): VerificationConfig | null {
  return SKILLS[docType]?.verification ?? null;
}
