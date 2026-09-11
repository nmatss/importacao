/**
 * Fixtures dos SUB-RECURSOS da pagina de detalhe do processo
 * (ProcessDetailPage e suas abas). Nao cobre `/api/processes` nem
 * `/api/processes/:id` — isso vive em `importacao-core`.
 *
 * O processo 1 e o mais "cheio" (BL final, OHBL, aceites, 24 itens de
 * espelho...). Qualquer outro id recebe uma variante mais leve, sem BL final e
 * com dois Draft BL, para a auditoria visual cobrir os dois layouts.
 */
import type { FixtureHandler } from './types';
import { paginated, ok } from './types';
import { PROCESSES } from './importacao-core';

// ── Utilidades ──────────────────────────────────────────────────────────

/** Primeiro segmento numerico do pathname (`/api/documents/process/7/...` → 7). */
const idFrom = (url: URL): number => Number(url.pathname.match(/\/(\d+)(?:\/|$)/)?.[1] ?? 1);
const isFull = (url: URL): boolean => idFrom(url) === 1;

/** Codigo do processo 1 no core (Pre-Cons cruza divergencias por codigo). */
export const PROCESS_CODE_1 = PROCESSES[0]?.processCode ?? 'IMP-2026-0001 PUKET';

const at = (day: number, hour = 9, minute = 0, month = 8): string =>
  new Date(Date.UTC(2026, month - 1, day, hour + 3, minute)).toISOString();

/** Campo extraido pela IA no formato `{ value, confidence }`. */
const ai = <T>(value: T, confidence = 0.9) => ({ value, confidence });

// ── Tipos (espelham as interfaces locais dos componentes consumidores) ──

type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

interface ValidationCheck {
  id: number;
  processId: number;
  checkName: string;
  status: CheckStatus;
  expectedValue: string | null;
  actualValue: string | null;
  documentsCompared: string;
  dataSource: 'cross_document' | 'system_vs_document';
  message: string;
  resolvedBy?: number | null;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
  resolvedManually?: boolean;
  resolutionNote?: string | null;
  createdAt: string;
}

interface ExtractionCoverage {
  readPercent: number;
  effectiveReadPercent?: number;
  trackedMissingFields?: string[];
  trackedTotalWeight?: number;
  trackedFilledWeight?: number;
  totalFields: number;
  filledFields: number;
  missingFields: string[];
  lowConfidenceFields: string[];
}

interface FixtureDocument {
  id: number;
  processId: number;
  fileName: string;
  documentType: string;
  uploadedAt: string;
  aiProcessingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  aiParsedData: Record<string, unknown> | null;
  aiConfidence: number | null;
  extractionCoverage: ExtractionCoverage | null;
  driveFileId: string | null;
  storagePath: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

type RowStatus = 'match' | 'warning' | 'divergent' | 'empty' | 'single_source';

interface AggregateField {
  rowKey: string;
  label: string;
  invoice: string | null;
  packingList: string | null;
  bl: string | null;
  espelho: string | null;
  status: RowStatus;
  criticality?: 'critical' | 'secondary' | 'info';
  message?: string | null;
  overrides?: Array<{
    id: number;
    rowKey: string;
    fieldLabel: string;
    sourceColumn: 'invoice' | 'packingList' | 'bl' | 'espelho' | 'system';
    valueText: string | null;
    note: string | null;
    editedAt: string;
    editedBy: number | null;
    editedByName?: string | null;
  }>;
}

interface ItemComparison {
  rowKey: string;
  itemCode: string;
  description: string;
  ncm: string;
  invoiceQty: number | null;
  plQty: number | null;
  espelhoQty: number | null;
  invoiceUnitPrice: number | null;
  invoiceTotal: number | null;
  espelhoUnitPrice: number | null;
  espelhoTotal: number | null;
  invoiceManufacturer?: string | null;
  plManufacturer?: string | null;
  espelhoManufacturer?: string | null;
  manufacturerMatch?: boolean | null;
  invoiceBoxes: number | null;
  plBoxes: number | null;
  espelhoBoxes: number | null;
  invoiceNetWeight: number | null;
  plNetWeight: number | null;
  espelhoNetWeight: number | null;
  invoiceGrossWeight: number | null;
  plGrossWeight: number | null;
  espelhoGrossWeight: number | null;
  isFreeOfCharge?: boolean;
  weightRatioStatus?: RowStatus;
  weightRatioMessage?: string | null;
  qtyMatch: boolean | null;
  matched: boolean;
  espelhoMatched: boolean;
  divergence?: string | null;
  status?: RowStatus;
  message?: string | null;
}

// ── Validacao (/api/validation/:id) ─────────────────────────────────────

const CHECK_SEED: Array<
  [string, CheckStatus, string, string | null, string | null, string?, boolean?]
> = [
  [
    'exporter-match',
    'passed',
    'Exportador identico na Invoice, no Packing List e no BL (Zhejiang Meiya Knitting Co., Ltd.).',
    null,
    null,
  ],
  [
    'importer-match',
    'passed',
    'Importador confere com o cadastro (Puket Comercial Ltda.).',
    null,
    null,
  ],
  [
    'process-reference',
    'warning',
    'A referencia interna IMP-2026-001 consta na Invoice e no Packing List, mas o BL traz apenas "PUKET 001/26" no campo de marcas e numeros. Confirme com o agente de carga se a referencia completa sera incluida no BL original.',
    'IMP-2026-001',
    'PUKET 001/26',
  ],
  ['incoterm-check', 'passed', 'Incoterm FOB consistente entre documentos.', null, null],
  [
    'ports-match',
    'failed',
    'Porto de descarga divergente: a Invoice indica Santos e o BL indica Itapoa. Verifique se houve troca de rota apos a emissao da fatura.',
    'Santos, BR',
    'Itapoa, BR',
  ],
  [
    'dates-match',
    'warning',
    'ETD da Invoice (2026-08-02) difere em 3 dias da data de embarque do BL (2026-08-05). Diferenca dentro da tolerancia, mas registre no Follow-Up.',
    '2026-08-02',
    '2026-08-05',
  ],
  ['currency-check', 'passed', 'Moeda USD em todos os documentos.', null, null],
  [
    'fob-calculation',
    'failed',
    'Soma dos itens (USD 48.190,00) difere do total FOB declarado (USD 48.250,00). Diferenca de USD 60,00 provavelmente originada por desconto FOC nao listado.',
    'USD 48.250,00',
    'USD 48.190,00',
    'Invoice',
    true,
  ],
  [
    'description-odoo-match',
    'skipped',
    'Integracao Odoo sem resposta para este processo. Verificacao bloqueada ate a proxima sincronizacao.',
    null,
    null,
  ],
  [
    'box-quantity-match',
    'failed',
    'Quantidade de volumes divergente: Invoice declara 412 caixas, Packing List 418 e BL 418.',
    '418',
    '412',
  ],
  [
    'net-weight-match',
    'warning',
    'Peso liquido do Packing List (6.842,50 kg) difere 0,8% do Espelho (6.790,00 kg).',
    '6.842,50 kg',
    '6.790,00 kg',
  ],
  ['gross-weight-match', 'passed', 'Peso bruto 7.915,00 kg conferido em PL e BL.', null, null],
  [
    'cbm-match',
    'failed',
    'Cubagem do Packing List (58,40 m3) nao bate com o BL (61,20 m3). Diferenca acima de 2%.',
    '58,40 m3',
    '61,20 m3',
  ],
  ['freight-value-match', 'passed', 'Frete USD 3.850,00 confere com o BL.', null, null],
  [
    'unit-type-validation',
    'passed',
    'Todas as unidades sao PCS/PAR, aceitas no espelho.',
    null,
    null,
  ],
  [
    'manufacturer-completeness',
    'warning',
    '3 de 24 itens do espelho estao sem fabricante preenchido (SKU-0011, SKU-0017, SKU-0023).',
    null,
    null,
  ],
  [
    'ncm-bl-description',
    'failed',
    'Os 4 primeiros digitos das NCMs do OHBL final nao cobrem todas as NCMs do Espelho: 6115 e 6111 constam, mas 6212 e 4202 nao aparecem no BL.',
    '6115, 6111, 6212, 4202',
    '6115, 6111',
  ],
  [
    'invoice-value-vs-fup',
    'passed',
    'Valor da Invoice confere com o valor FOB cadastrado no sistema.',
    'USD 48.250,00',
    'USD 48.250,00',
    'Invoice vs Sistema',
  ],
  [
    'freight-vs-fup',
    'warning',
    'Frete no sistema (USD 3.700,00) esta abaixo do BL (USD 3.850,00). Atualize o Follow-Up.',
    'USD 3.700,00',
    'USD 3.850,00',
    'BL vs Sistema',
  ],
  [
    'cbm-vs-fup',
    'failed',
    'CBM cadastrado no sistema (55,00 m3) diverge do Packing List (58,40 m3).',
    '55,00 m3',
    '58,40 m3',
    'Packing List vs Sistema',
  ],
  [
    'container-type-vs-fup',
    'passed',
    'Container 40HC confere com o sistema.',
    '40HC',
    '40HC',
    'BL vs Sistema',
  ],
  [
    'item-level-match',
    'warning',
    '2 itens do Packing List sem correspondencia na Invoice e 1 item da Invoice sem correspondencia no Packing List. Veja a lista no Comparativo Geral.',
    null,
    null,
  ],
  [
    'payment-terms-check',
    'passed',
    'Condicoes 30% deposito / 70% saldo em 45 dias conferem com a Proforma.',
    null,
    null,
  ],
  [
    'date-sequence-check',
    'skipped',
    'Data de emissao do BL nao extraida; sequencia de datas nao pode ser verificada.',
    null,
    null,
  ],
  [
    'weight-ratio-check',
    'warning',
    'Proporcao peso bruto/liquido de 1,16 para o SKU-0004 esta acima da media do lote (1,09).',
    '<= 1,12',
    '1,16',
  ],
  [
    'supplier-address-match',
    'skipped',
    'Endereco do fornecedor ausente no cadastro; nada a comparar.',
    null,
    null,
  ],
  [
    'certificate-completeness',
    'skipped',
    'Certificado com falha de extracao. Reprocesse o documento para liberar esta verificacao.',
    null,
    null,
  ],
];

function buildChecks(processId: number): ValidationCheck[] {
  return CHECK_SEED.map(([checkName, status, message, expected, actual, compared, resolved], i) => {
    const documentsCompared = compared ?? 'Invoice vs Packing List vs BL';
    const check: ValidationCheck = {
      id: processId * 100 + i + 1,
      processId,
      checkName,
      status,
      expectedValue: expected,
      actualValue: actual,
      documentsCompared,
      dataSource: documentsCompared.includes('Sistema') ? 'system_vs_document' : 'cross_document',
      message,
      createdAt: at(12, 10, i),
    };
    if (resolved) {
      check.resolvedManually = true;
      check.resolvedBy = 2;
      check.resolvedByName = 'Eduarda Lima';
      check.resolvedAt = at(13, 15, 42);
      check.resolutionNote =
        'Diferenca de USD 60,00 corresponde ao desconto FOC do SKU-0012 confirmado por e-mail com o fornecedor em 12/08.';
    }
    return check;
  });
}

const CHECKS_FULL = buildChecks(1);
const checksFor = (url: URL): ValidationCheck[] =>
  isFull(url) ? CHECKS_FULL : buildChecks(idFrom(url)).slice(0, 12);

function buildReport(url: URL) {
  const checks = checksFor(url);
  return {
    processCode: isFull(url) ? PROCESS_CODE_1 : `IMP-2026-${String(idFrom(url)).padStart(3, '0')}`,
    brand: 'puket',
    status: 'validating',
    generatedAt: at(14, 8),
    processData: {
      totalFobValue: '48250.00',
      freightValue: '3700.00',
      totalCbm: '55.00',
      containerType: '40HC',
    },
    systemDataAvailable: isFull(url),
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.status === 'passed').length,
      failed: checks.filter((c) => c.status === 'failed').length,
      warnings: checks.filter((c) => c.status === 'warning').length,
      skipped: checks.filter((c) => c.status === 'skipped').length,
    },
    crossDocumentChecks: checks.filter((c) => c.dataSource === 'cross_document'),
    systemChecks: checks.filter((c) => c.dataSource === 'system_vs_document'),
  };
}

const ANOMALIES = {
  anomalies: [
    {
      field: 'items.unmatched.pl',
      description:
        'Itens do Packing List sem correspondencia na Invoice. A contagem oficial esta no Comparativo Geral.',
      severity: 'high' as const,
      confidence: 0.98,
    },
    {
      field: 'totalCbm',
      description:
        'A cubagem do BL (61,20 m3) e 4,8% maior que a do Packing List (58,40 m3); em processos anteriores do mesmo fornecedor a diferenca nunca passou de 1%.',
      severity: 'high' as const,
      confidence: 0.87,
    },
    {
      field: 'portOfDischarge',
      description:
        'Porto de descarga Itapoa no BL contrasta com Santos na Invoice e com os 14 processos anteriores da marca, todos por Santos.',
      severity: 'medium' as const,
      confidence: 0.81,
    },
    {
      field: 'items[4].unitPrice',
      description:
        'Preco unitario do SKU-0005 (USD 4,90) esta 38% acima da Proforma PI-2026-0417 (USD 3,55).',
      severity: 'medium' as const,
      confidence: 0.74,
    },
    {
      field: 'paymentTerms',
      description: 'Prazo de saldo de 45 dias; o padrao historico do fornecedor e 30 dias.',
      severity: 'low' as const,
      confidence: 0.52,
    },
  ],
};

const CORRECTION_DRAFT = {
  id: 9001,
  processId: 1,
  recipient: 'Zhejiang Meiya Knitting Co., Ltd.',
  recipientEmail: 'export@meiya-knitting.example.com, sales.assist@meiya-knitting.example.com',
  subject: 'IMP-2026-001 / PI-2026-0417 — Correction request: Invoice, Packing List and BL',
  body: '<p>Dear Meiya team,</p><p>While reviewing the shipping documents for order <strong>IMP-2026-001</strong> we found the following discrepancies that must be corrected before customs clearance in Brazil:</p><ol><li><strong>Port of discharge</strong>: Invoice states Santos, BL states Itapoa.</li><li><strong>Number of packages</strong>: Invoice 412 cartons vs Packing List/BL 418 cartons.</li><li><strong>CBM</strong>: Packing List 58.40 m3 vs BL 61.20 m3.</li><li><strong>NCM codes on BL</strong>: 6212 and 4202 are missing from the BL description.</li></ol><p>Please send the revised documents by Friday.</p><p>Best regards,</p>',
  status: 'draft',
  createdAt: at(14, 9, 5),
};

// ── Documentos (/api/documents/process/:id) ─────────────────────────────

interface ExtractedItem {
  itemCode: string;
  description: string;
  quantity: number;
  unitType: string;
  unitPrice?: number;
  ean: string | null;
  color: string | null;
  size: string | null;
  netWeight: number;
  grossWeight: number;
  ncmCode: string;
}

const INVOICE_ITEMS: ExtractedItem[] = [
  {
    itemCode: 'SKU-0001',
    description: 'MEIA INFANTIL CANO MEDIO ALGODAO PENTEADO ESTAMPA DINOSSAURO',
    quantity: 2400,
    unitType: 'PAR',
    unitPrice: 1.85,
    ean: '7891234500011',
    color: 'AZUL MARINHO',
    size: '23-26',
    netWeight: 288,
    grossWeight: 312,
    ncmCode: '6115.95.00',
  },
  {
    itemCode: 'SKU-0002',
    description: 'MEIA INFANTIL CANO MEDIO ALGODAO PENTEADO ESTAMPA UNICORNIO',
    quantity: 2400,
    unitType: 'PAR',
    unitPrice: 1.85,
    ean: '7891234500028',
    color: 'ROSA CHICLETE',
    size: '23-26',
    netWeight: 288,
    grossWeight: 312,
    ncmCode: '6115.95.00',
  },
  {
    itemCode: 'SKU-0003',
    description: 'MEIA ADULTO SAPATILHA INVISIVEL COM SILICONE NO CALCANHAR KIT 3 PARES',
    quantity: 3600,
    unitType: 'PAR',
    unitPrice: 1.2,
    ean: '7891234500035',
    color: 'PRETO',
    size: '35-39',
    netWeight: 216,
    grossWeight: 240,
    ncmCode: '6115.96.00',
  },
  {
    itemCode: 'SKU-0004',
    description: 'PIJAMA INFANTIL LONGO MALHA PENTEADA ESTAMPA ESPACIAL COM BRILHO NO ESCURO',
    quantity: 1200,
    unitType: 'PCS',
    unitPrice: 6.4,
    ean: '7891234500042',
    color: 'AZUL ROYAL',
    size: '4',
    netWeight: 420,
    grossWeight: 488,
    ncmCode: '6111.20.00',
  },
  {
    itemCode: 'SKU-0005',
    description: 'CUECA BOXER INFANTIL ALGODAO COM ELASTANO KIT 2 PECAS',
    quantity: 1800,
    unitType: 'PCS',
    unitPrice: 4.9,
    ean: '7891234500059',
    color: 'SORTIDO',
    size: '6',
    netWeight: 252,
    grossWeight: 276,
    ncmCode: '6212.10.00',
  },
  {
    itemCode: 'SKU-0006',
    description: 'NECESSAIRE INFANTIL NEOPRENE ESTAMPA TUBAROES',
    quantity: 900,
    unitType: 'PCS',
    unitPrice: 2.75,
    ean: '7891234500066',
    color: 'VERDE',
    size: 'U',
    netWeight: 108,
    grossWeight: 126,
    ncmCode: '4202.92.00',
  },
  {
    itemCode: 'SKU-0007',
    description: 'MEIA CALCA INFANTIL FIO 40 LISA',
    quantity: 2000,
    unitType: 'PCS',
    unitPrice: 2.1,
    ean: '7891234500073',
    color: 'BRANCO',
    size: '2-4',
    netWeight: 160,
    grossWeight: 180,
    ncmCode: '6115.29.90',
  },
  {
    itemCode: 'SKU-0008',
    description: 'MEIA ADULTO CANO ALTO ALGODAO LISTRADA (MOSTRUARIO)',
    quantity: 60,
    unitType: 'PAR',
    unitPrice: 0,
    ean: '7891234500080',
    color: 'CINZA MESCLA',
    size: '39-43',
    netWeight: 9,
    grossWeight: 10,
    ncmCode: '6115.95.00',
  },
];

/** Preco da Proforma: o SKU-0005 subiu de 3,55 para 4,90 na Invoice (anomalia de preco). */
const piUnitPrice = (it: ExtractedItem): number =>
  it.itemCode === 'SKU-0005' ? 3.55 : (it.unitPrice ?? 0);

const CARGO_DESCRIPTION =
  '412 CARTONS CONTAINING SOCKS, PAJAMAS, UNDERWEAR AND NEOPRENE POUCHES\nHS CODES: 6115.95.00 / 6115.96.00 / 6111.20.00 / 6212.10.00 / 4202.92.00\nSHIPPER DECLARES THAT NO WOOD PACKAGING MATERIAL IS USED IN THIS SHIPMENT\nFREIGHT PREPAID — 14 DAYS FREE TIME AT DESTINATION\nCONTAINER: MSKU7781234 / SEAL: CN9921A\nORDER REF.: IMP-2026-001 / PI-2026-0417 / PUKET 001/26';

const INVOICE_DATA: Record<string, unknown> = {
  invoiceNumber: ai('MY-INV-2026-08842', 0.97),
  invoiceDate: ai('2026-07-28', 0.95),
  exporterName: ai('ZHEJIANG MEIYA KNITTING CO., LTD.', 0.96),
  exporterTaxId: ai('91330000MA2H1X5R7T', 0.71),
  importerName: ai('PUKET COMERCIAL LTDA.', 0.98),
  importerCnpj: ai('12.345.678/0001-90', 0.93),
  incoterm: ai('FOB', 0.99),
  currency: ai('USD', 0.99),
  portOfLoading: ai('NINGBO, CN', 0.94),
  portOfDischarge: ai('SANTOS, BR', 0.9),
  shipmentDate: ai('2026-08-02', 0.82),
  etd: ai('2026-08-02', 0.82),
  shippedOnBoardDate: ai(null, 0),
  totalFobValue: ai(48250, 0.96),
  totalBoxes: ai(412, 0.88),
  totalNetWeight: ai(6742.5, 0.8),
  totalGrossWeight: ai(7915, 0.84),
  totalCbm: ai(58.4, 0.79),
  manufacturerName: ai('ZHEJIANG MEIYA KNITTING CO., LTD. / YIWU HUAXIN SOCKS FACTORY', 0.62),
  paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 45 },
  cargoDescription: ai(CARGO_DESCRIPTION, 0.9),
  items: INVOICE_ITEMS,
  supplierFooterAliases: ['MEIYA', 'HUAXIN SOCKS', 'YIWU HUAXIN'],
  _trust: { trust: 'ok', findings: [] },
};

const PACKING_LIST_DATA: Record<string, unknown> = {
  packingListNumber: ai('MY-PL-2026-08842', 0.95),
  invoiceNumber: ai('MY-INV-2026-08842', 0.95),
  date: ai('2026-07-29', 0.9),
  exporterName: ai('ZHEJIANG MEIYA KNITTING CO., LTD.', 0.96),
  importerName: ai('PUKET COMERCIAL LTDA.', 0.98),
  portOfLoading: ai('NINGBO, CN', 0.94),
  portOfDischarge: ai('SANTOS, BR', 0.9),
  shipmentDate: ai('2026-08-02', 0.75),
  totalBoxes: ai(418, 0.92),
  totalNetWeight: ai(6842.5, 0.9),
  totalGrossWeight: ai(7915, 0.91),
  totalCbm: ai(58.4, 0.86),
  items: [
    ...INVOICE_ITEMS.map(
      (it, i): ExtractedItem => ({
        ...it,
        quantity: i === 4 ? 1740 : it.quantity,
        unitPrice: undefined,
      }),
    ),
    {
      itemCode: 'SKU-0099',
      description: 'SACOLA PROMOCIONAL TNT (BRINDE)',
      quantity: 500,
      unitType: 'PCS',
      unitPrice: 0,
      ean: '7891234500998',
      color: 'BRANCO',
      size: 'U',
      netWeight: 25,
      grossWeight: 28,
      ncmCode: '6305.32.00',
    },
    {
      itemCode: 'SKU-0100',
      description: 'DISPLAY DE BALCAO PAPELAO',
      quantity: 40,
      unitType: 'PCS',
      unitPrice: 0,
      ean: null,
      color: null,
      size: null,
      netWeight: 30,
      grossWeight: 34,
      ncmCode: '4819.20.00',
    },
  ] satisfies ExtractedItem[],
};

const OHBL_DATA: Record<string, unknown> = {
  blNumber: ai('MAEU2268841190', 0.97),
  issueDate: ai('2026-08-06', 0.9),
  shipper: ai(
    'ZHEJIANG MEIYA KNITTING CO., LTD. NO. 88 HUANCHENG ROAD, ZHUJI, ZHEJIANG, CHINA',
    0.93,
  ),
  consignee: ai(
    'PUKET COMERCIAL LTDA. RUA EXEMPLO 1200, SAO PAULO - SP, BRAZIL. CNPJ 12.345.678/0001-90',
    0.95,
  ),
  vesselName: ai('MAERSK LOTA', 0.96),
  voyageNumber: ai('632W', 0.9),
  portOfLoading: ai('NINGBO, CN', 0.96),
  portOfDischarge: ai('ITAPOA, BR', 0.94),
  etd: ai('2026-08-05', 0.85),
  eta: ai('2026-09-12', 0.8),
  shipmentDate: ai('2026-08-05', 0.9),
  containerNumber: ai('MSKU7781234', 0.98),
  containerType: ai('40HC', 0.95),
  totalBoxes: ai(418, 0.92),
  totalGrossWeight: ai(7915, 0.9),
  totalCbm: ai(61.2, 0.83),
  freightValue: ai(3850, 0.88),
  freightCurrency: ai('USD', 0.95),
  freeTime: ai(14, 0.86),
  woodDeclaration: ai(true, 0.91),
  ncmList: ai(['6115.95.00', '6115.96.00', '6111.20.00'], 0.8),
  cargoDescription: ai(CARGO_DESCRIPTION, 0.9),
};

const DRAFT_BL_DATA: Record<string, unknown> = {
  blNumber: ai('MAEU2268841190', 0.85),
  shipper: ai('ZHEJIANG MEIYA KNITTING CO., LTD.', 0.9),
  consignee: ai('PUKET COMERCIAL LTDA.', 0.92),
  vesselName: ai('MAERSK LOTA', 0.93),
  portOfLoading: ai('NINGBO, CN', 0.94),
  portOfDischarge: ai('SANTOS, BR', 0.9),
  etd: ai('2026-08-02', 0.7),
  eta: ai('2026-09-10', 0.7),
  containerNumber: ai('MSKU7781234', 0.95),
  totalBoxes: ai(412, 0.8),
  totalGrossWeight: ai(7900, 0.78),
  totalCbm: ai(58.4, 0.8),
  freightValue: ai(3850, 0.75),
  freightCurrency: ai('USD', 0.9),
  freeTime: null,
  woodDeclaration: ai(false, 0.66),
  ncmList: ai(['6115.95.00', '6111.20.00'], 0.72),
  cargoDescription: ai(
    '412 CARTONS OF SOCKS AND PAJAMAS\nHS 6115 / 6111\nORDER REF.: IMP-2026-001',
    0.8,
  ),
};

const DRAFT_BL_DATA_OLD: Record<string, unknown> = {
  ...DRAFT_BL_DATA,
  vesselName: ai('MAERSK LIMA', 0.8),
  containerNumber: ai(null, 0),
  totalGrossWeight: ai(7800, 0.6),
  cargoDescription: ai('412 CARTONS OF SOCKS AND PAJAMAS', 0.7),
};

const PROFORMA_DATA: Record<string, unknown> = {
  invoiceNumber: ai('PI-2026-0417', 0.96),
  invoiceDate: ai('2026-05-14', 0.9),
  validUntil: ai('2026-06-30', 0.8),
  exporterName: ai('ZHEJIANG MEIYA KNITTING CO., LTD.', 0.95),
  currency: ai('USD', 0.98),
  totalFobValue: ai(48250, 0.93),
  paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 45 },
  items: INVOICE_ITEMS.slice(0, 7).map((it) => ({
    itemCode: it.itemCode,
    description: it.description,
    quantity: it.quantity,
    unitPrice: piUnitPrice(it),
    totalPrice: Number((piUnitPrice(it) * it.quantity).toFixed(2)),
    ncmCode: it.ncmCode,
  })),
};

const COVERAGE_INVOICE: ExtractionCoverage = {
  readPercent: 90,
  effectiveReadPercent: 86,
  trackedMissingFields: ['shippedOnBoardDate'],
  trackedTotalWeight: 22,
  trackedFilledWeight: 19,
  totalFields: 20,
  filledFields: 18,
  missingFields: ['shippedOnBoardDate', 'exporterAddress'],
  lowConfidenceFields: ['exporterTaxId', 'manufacturerName'],
};

const COVERAGE_DRAFT: ExtractionCoverage = {
  readPercent: 71,
  totalFields: 17,
  filledFields: 12,
  missingFields: ['freeTime', 'issueDate', 'voyageNumber', 'containerType', 'eta'],
  lowConfidenceFields: ['woodDeclaration', 'ncmList', 'etd'],
};

function doc(
  id: number,
  processId: number,
  fileName: string,
  documentType: string,
  day: number,
  status: FixtureDocument['aiProcessingStatus'],
  aiParsedData: Record<string, unknown> | null,
  aiConfidence: number | null,
  extras: Partial<FixtureDocument> = {},
): FixtureDocument {
  return {
    id,
    processId,
    fileName,
    documentType,
    uploadedAt: at(day, 11, id % 60),
    aiProcessingStatus: status,
    aiParsedData,
    aiConfidence,
    extractionCoverage: null,
    driveFileId: `1AbC${id}xYz-drive-file-id-${processId}`,
    storagePath: `/data/uploads/${processId}/${fileName}`,
    mimeType: fileName.endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf',
    fileSize: 240_000 + id * 17_331,
    ...extras,
  };
}

function buildDocuments(processId: number): FixtureDocument[] {
  const p = processId;
  const base = p * 1000;
  const full: FixtureDocument[] = [
    doc(
      base + 1,
      p,
      'MY-INV-2026-08842_COMMERCIAL_INVOICE_PUKET_IMP-2026-001_ORDER_PI-2026-0417_REV2_FINAL_SIGNED.pdf',
      'invoice',
      8,
      'completed',
      INVOICE_DATA,
      0.93,
      { extractionCoverage: COVERAGE_INVOICE },
    ),
    doc(
      base + 2,
      p,
      'MY-INV-2026-08842_COMMERCIAL_INVOICE_scan_baixa_resolucao_v1.pdf',
      'invoice',
      6,
      'completed',
      {
        ...INVOICE_DATA,
        _trust: {
          trust: 'review',
          groundingSkipped: true,
          findings: [
            { severity: 'error', message: 'Total FOB nao encontrado no texto do documento.' },
          ],
        },
      },
      0.35,
    ),
    doc(
      base + 3,
      p,
      'MY-PL-2026-08842_PACKING_LIST_PUKET_IMP-2026-001_418CTNS_MSKU7781234.pdf',
      'packing_list',
      8,
      'completed',
      PACKING_LIST_DATA,
      0.88,
    ),
    doc(
      base + 4,
      p,
      'OHBL_MAEU2268841190_MAERSK_LOTA_632W_NINGBO-ITAPOA_ORIGINAL_BILL_OF_LADING_PUKET_IMP-2026-001.pdf',
      'ohbl',
      12,
      'completed',
      OHBL_DATA,
      0.91,
    ),
    doc(
      base + 5,
      p,
      'DRAFT_BL_MAEU2268841190_rev2_corrigido_madeira_e_freetime_PUKET_IMP-2026-001.pdf',
      'draft_bl',
      9,
      'completed',
      DRAFT_BL_DATA,
      0.72,
      { extractionCoverage: COVERAGE_DRAFT },
    ),
    doc(
      base + 6,
      p,
      'DRAFT_BL_MAEU2268841190_rev1_recebido_agente_carga.pdf',
      'draft_bl',
      5,
      'completed',
      DRAFT_BL_DATA_OLD,
      0.66,
      { extractionCoverage: COVERAGE_DRAFT },
    ),
    doc(
      base + 7,
      p,
      'PI-2026-0417_PROFORMA_INVOICE_MEIYA_KNITTING_PUKET_SS27_SOCKS_PAJAMAS_UNDERWEAR.pdf',
      'proforma_invoice',
      1,
      'completed',
      PROFORMA_DATA,
      0.85,
      { uploadedAt: at(14, 10, 0, 5) },
    ),
    doc(
      base + 8,
      p,
      'ESPELHO_IMPORTACAO_PUKET_IMP-2026-001_MEIYA_v3_conferido_fiscal_2026-08-13.xlsx',
      'espelho',
      13,
      'completed',
      {
        summary: {
          totalFobValue: 48190,
          totalQuantity: 14360,
          totalBoxes: 418,
          suppliers: ['MEIYA', 'HUAXIN SOCKS', 'DONGYANG PACKAGING'],
        },
        items: INVOICE_ITEMS,
      },
      0.97,
    ),
    doc(
      base + 9,
      p,
      'LI_SISCOMEX_26-1234567-8_solicitacao_pijama_infantil_INMETRO.pdf',
      'li',
      14,
      'pending',
      null,
      null,
      { driveFileId: null },
    ),
    doc(
      base + 10,
      p,
      'CERTIFICADO_CONFORMIDADE_INMETRO_PIJAMA_INFANTIL_OCP-0042_2026_scan_frente_verso.pdf',
      'certificate',
      11,
      'failed',
      {
        extractionFailed: true,
        reason:
          'Documento escaneado em baixa resolucao; OCR retornou menos de 5% dos campos esperados.',
      },
      null,
    ),
    doc(
      base + 11,
      p,
      'DRAFT_DUIMP_26BR000123456789_despachante_v1.pdf',
      'draft_duimp',
      15,
      'completed',
      {
        duimpNumber: ai('26BR000123456789', 0.9),
        registrationDate: ai('2026-09-14', 0.7),
        customsValue: ai('312450.88', 0.85),
        exchangeRate: ai('5.4321', 0.9),
        insurance: ai('1850.00', 0.8),
        customsChannel: ai('VERDE', 0.6),
      },
      0.81,
    ),
    doc(
      base + 12,
      p,
      'email_agente_carga_2026-08-15_confirmacao_freetime_e_madeira.eml',
      'other',
      15,
      'processing',
      null,
      null,
      { mimeType: 'message/rfc822', driveFileId: null },
    ),
  ];
  if (p === 1) return full;
  // Variante leve: sem BL final (DraftBLTab mostra o fluxo de draft + revisado),
  // sem LI/certificado, com o certificado falho mantido para o estado de erro.
  return full.filter((d) => !['ohbl', 'li', 'draft_duimp', 'espelho'].includes(d.documentType));
}

const DOCS_FULL = buildDocuments(1);
const documentsFor = (url: URL) => (isFull(url) ? DOCS_FULL : buildDocuments(idFrom(url)));

// ── Comparativo (/api/documents/process/:id/comparison) ─────────────────

const AGGREGATE_FULL: AggregateField[] = [
  {
    rowKey: 'aggregate:exportador',
    label: 'Exportador',
    invoice: 'ZHEJIANG MEIYA KNITTING CO., LTD.',
    packingList: 'ZHEJIANG MEIYA KNITTING CO., LTD.',
    bl: 'ZHEJIANG MEIYA KNITTING CO., LTD. NO. 88 HUANCHENG ROAD, ZHUJI',
    espelho: 'MEIYA KNITTING',
    status: 'match',
    criticality: 'critical',
    message: 'Exportador conforme em todas as fontes.',
  },
  {
    rowKey: 'aggregate:importador',
    label: 'Importador',
    invoice: 'PUKET COMERCIAL LTDA.',
    packingList: 'PUKET COMERCIAL LTDA.',
    bl: 'PUKET COMERCIAL LTDA. RUA EXEMPLO 1200, SAO PAULO - SP',
    espelho: 'PUKET COMERCIAL LTDA.',
    status: 'match',
    criticality: 'critical',
    message: null,
  },
  {
    rowKey: 'aggregate:incoterm',
    label: 'Incoterm',
    invoice: 'FOB',
    packingList: null,
    bl: null,
    espelho: 'FOB',
    status: 'match',
    criticality: 'secondary',
    message: 'Packing List e BL nao trazem Incoterm.',
  },
  {
    rowKey: 'aggregate:moeda',
    label: 'Moeda',
    invoice: 'USD',
    packingList: null,
    bl: 'USD',
    espelho: 'USD',
    status: 'match',
    criticality: 'secondary',
    message: null,
  },
  {
    rowKey: 'aggregate:porto-de-embarque',
    label: 'Porto de Embarque',
    invoice: 'NINGBO, CN',
    packingList: 'NINGBO, CN',
    bl: 'NINGBO, CN',
    espelho: 'NINGBO',
    status: 'match',
    criticality: 'critical',
    message: null,
  },
  {
    rowKey: 'aggregate:porto-de-descarga',
    label: 'Porto de Descarga',
    invoice: 'SANTOS, BR',
    packingList: 'SANTOS, BR',
    bl: 'ITAPOA, BR',
    espelho: 'SANTOS',
    status: 'divergent',
    criticality: 'critical',
    message:
      'BL indica Itapoa enquanto Invoice, Packing List e Espelho indicam Santos. Confirme a rota com o agente de carga antes de registrar a DUIMP.',
  },
  {
    rowKey: 'aggregate:total-fob-usd',
    label: 'Total FOB (USD)',
    invoice: '48.250,00',
    packingList: null,
    bl: null,
    espelho: '48.190,00',
    status: 'warning',
    criticality: 'critical',
    message: 'Diferenca de USD 60,00 entre Invoice e Espelho (desconto FOC do SKU-0012).',
  },
  {
    rowKey: 'aggregate:frete',
    label: 'Frete',
    invoice: null,
    packingList: null,
    bl: 'USD 3.850,00',
    espelho: 'USD 3.850,00',
    status: 'match',
    criticality: 'critical',
    message: null,
  },
  {
    rowKey: 'aggregate:total-caixas',
    label: 'Total Caixas',
    invoice: '412',
    packingList: '418',
    bl: '418',
    espelho: '418',
    status: 'divergent',
    criticality: 'critical',
    message:
      'Invoice declara 412 caixas; as demais fontes declaram 418. Os 6 volumes extras sao brindes (SKU-0099/SKU-0100) listados apenas no Packing List.',
    overrides: [
      {
        id: 501,
        rowKey: 'aggregate:total-caixas',
        fieldLabel: 'Total Caixas',
        sourceColumn: 'invoice',
        valueText: '412',
        note: 'Valor conferido no PDF original; a IA havia lido 421.',
        editedAt: at(13, 16, 20),
        editedBy: 3,
        editedByName: 'Odett Ferreira',
      },
    ],
  },
  {
    rowKey: 'aggregate:peso-liquido-kg',
    label: 'Peso Liquido (kg)',
    invoice: '6.742,50',
    packingList: '6.842,50',
    bl: null,
    espelho: '6.790,00',
    status: 'warning',
    criticality: 'secondary',
    message: 'Variacao de ate 1,5% entre as fontes; dentro da tolerancia operacional.',
  },
  {
    rowKey: 'aggregate:peso-bruto-kg',
    label: 'Peso Bruto (kg)',
    invoice: '7.915,00',
    packingList: '7.915,00',
    bl: '7.915,00',
    espelho: '7.915,00',
    status: 'match',
    criticality: 'critical',
    message: null,
  },
  {
    rowKey: 'aggregate:cbm-m3',
    label: 'CBM (m3)',
    invoice: '58,40',
    packingList: '58,40',
    bl: '61,20',
    espelho: '58,40',
    status: 'divergent',
    criticality: 'critical',
    message: 'BL com 61,20 m3 contra 58,40 m3 nas demais fontes (4,8% acima).',
  },
  {
    rowKey: 'aggregate:tipo-container',
    label: 'Tipo Container',
    invoice: null,
    packingList: null,
    bl: '40HC',
    espelho: '40HC',
    status: 'match',
    criticality: 'info',
    message: null,
  },
  {
    rowKey: 'aggregate:numero-bl',
    label: 'Numero BL',
    invoice: null,
    packingList: null,
    bl: 'MAEU2268841190',
    espelho: 'MAEU2268841190',
    status: 'single_source',
    criticality: 'info',
    message: 'Numero do BL presente apenas no BL e no Espelho.',
  },
  {
    rowKey: 'aggregate:data-embarque',
    label: 'Data Embarque',
    invoice: '02/08/2026',
    packingList: '02/08/2026',
    bl: '05/08/2026',
    espelho: '05/08/2026',
    status: 'warning',
    criticality: 'secondary',
    message: 'ETD da Invoice difere em 3 dias do embarque efetivo no BL.',
  },
  {
    rowKey: 'aggregate:referencia',
    label: 'Referencia',
    invoice: null,
    packingList: null,
    bl: null,
    espelho: null,
    status: 'empty',
    criticality: 'info',
    message: null,
  },
];

function item(
  n: number,
  overrides: Partial<ItemComparison> & { description: string; ncm: string },
): ItemComparison {
  const code = `SKU-${String(n).padStart(4, '0')}`;
  const qty = 1200 + n * 100;
  return {
    rowKey: `item:sku-${String(n).padStart(4, '0')}`,
    itemCode: code,
    invoiceQty: qty,
    plQty: qty,
    espelhoQty: qty,
    invoiceUnitPrice: 1.85,
    invoiceTotal: Number((qty * 1.85).toFixed(2)),
    espelhoUnitPrice: 1.85,
    espelhoTotal: Number((qty * 1.85).toFixed(2)),
    invoiceManufacturer: 'ZHEJIANG MEIYA KNITTING CO., LTD.',
    plManufacturer: 'ZHEJIANG MEIYA KNITTING CO., LTD.',
    espelhoManufacturer: 'MEIYA',
    manufacturerMatch: true,
    invoiceBoxes: 40 + n,
    plBoxes: 40 + n,
    espelhoBoxes: 40 + n,
    invoiceNetWeight: 250 + n * 3,
    plNetWeight: 250 + n * 3,
    espelhoNetWeight: 250 + n * 3,
    invoiceGrossWeight: 275 + n * 3,
    plGrossWeight: 275 + n * 3,
    espelhoGrossWeight: 275 + n * 3,
    qtyMatch: true,
    matched: true,
    espelhoMatched: true,
    ...overrides,
  };
}

const ITEMS_FULL: ItemComparison[] = [
  item(1, { description: INVOICE_ITEMS[0].description, ncm: '6115.95.00' }),
  item(2, { description: INVOICE_ITEMS[1].description, ncm: '6115.95.00' }),
  item(3, {
    description: INVOICE_ITEMS[2].description,
    ncm: '6115.96.00',
    invoiceUnitPrice: 1.2,
    espelhoUnitPrice: 1.2,
    invoiceTotal: 4320,
    espelhoTotal: 4320,
  }),
  item(4, {
    description: INVOICE_ITEMS[3].description,
    ncm: '6111.20.00',
    invoiceUnitPrice: 6.4,
    espelhoUnitPrice: 6.4,
    invoiceTotal: 7680,
    espelhoTotal: 7680,
    invoiceGrossWeight: 488,
    plGrossWeight: 488,
    espelhoGrossWeight: 488,
    invoiceNetWeight: 420,
    plNetWeight: 420,
    espelhoNetWeight: 420,
    weightRatioStatus: 'warning',
    weightRatioMessage: 'Bruto/liquido 1,16 (media do lote 1,09)',
  }),
  item(5, {
    description: INVOICE_ITEMS[4].description,
    ncm: '6212.10.00',
    invoiceQty: 1800,
    plQty: 1740,
    espelhoQty: 1800,
    invoiceUnitPrice: 4.9,
    espelhoUnitPrice: 4.9,
    invoiceTotal: 8820,
    espelhoTotal: 8820,
    qtyMatch: false,
    status: 'divergent',
    divergence: 'Qtd PL 1.740 x Invoice 1.800 (-60 pcs)',
    message:
      'Packing List lista 60 pecas a menos que a Invoice para este SKU. Fornecedor informou por e-mail que 1 caixa foi retirada por defeito de estampa; a Invoice precisa ser corrigida.',
  }),
  item(6, {
    description: INVOICE_ITEMS[5].description,
    ncm: '4202.92.00',
    invoiceUnitPrice: 2.75,
    espelhoUnitPrice: 2.75,
    invoiceTotal: 2475,
    espelhoTotal: 2475,
    plManufacturer: 'DONGYANG PACKAGING CO.',
    espelhoManufacturer: 'DONGYANG PACKAGING',
    manufacturerMatch: false,
    status: 'warning',
    message:
      'Fabricante do Packing List (Dongyang Packaging) difere da Invoice (Meiya). Confirmar qual sera declarado na DUIMP.',
  }),
  item(7, {
    description: INVOICE_ITEMS[6].description,
    ncm: '6115.29.90',
    invoiceUnitPrice: 2.1,
    espelhoUnitPrice: 2.1,
    invoiceTotal: 4200,
    espelhoTotal: 4200,
    espelhoMatched: false,
    espelhoQty: null,
    espelhoBoxes: null,
    espelhoNetWeight: null,
    espelhoGrossWeight: null,
    status: 'warning',
    message: 'Item nao localizado no Espelho (aceito manualmente).',
  }),
  item(8, {
    description: INVOICE_ITEMS[7].description,
    ncm: '6115.95.00',
    invoiceQty: 60,
    plQty: 60,
    espelhoQty: 60,
    invoiceUnitPrice: 0,
    espelhoUnitPrice: 0,
    invoiceTotal: 0,
    espelhoTotal: 0,
    invoiceBoxes: 1,
    plBoxes: 1,
    espelhoBoxes: 1,
    invoiceNetWeight: 9,
    plNetWeight: 9,
    espelhoNetWeight: 9,
    invoiceGrossWeight: 10,
    plGrossWeight: 10,
    espelhoGrossWeight: 10,
    isFreeOfCharge: true,
  }),
  item(9, {
    description: 'MEIA INFANTIL CANO CURTO ALGODAO LISA (REPOSICAO COLECAO ANTERIOR)',
    ncm: '6115.95.00',
    invoiceManufacturer: null,
    plManufacturer: null,
    espelhoManufacturer: null,
    manufacturerMatch: null,
  }),
  item(10, {
    description: 'MEIA ADULTO ESPORTIVA CANO MEDIO COM REFORCO NO CALCANHAR E PONTEIRA',
    ncm: '6115.96.00',
    invoiceUnitPrice: 1.45,
    espelhoUnitPrice: 1.5,
    invoiceTotal: 3190,
    espelhoTotal: 3300,
    status: 'divergent',
    divergence: 'Preco unitario Espelho 1,50 x Invoice 1,45',
    message:
      'Preco unitario do Espelho difere da Invoice; o Espelho precisa ser ajustado antes de enviar a Fenicia.',
  }),
];

function buildComparison(url: URL) {
  const full = isFull(url);
  const items = full ? ITEMS_FULL : ITEMS_FULL.slice(0, 5);
  return {
    hasInvoice: true,
    hasPackingList: true,
    hasBl: true,
    hasFinalBl: full,
    hasOperationalBl: true,
    operationalBlSource: full ? ('ohbl' as const) : ('draft_bl' as const),
    hasDraftBl: true,
    hasEspelho: true,
    acceptances: full
      ? [
          {
            id: 701,
            scope: 'aggregate',
            rowKey: 'aggregate:peso-liquido-kg',
            fieldLabel: 'Peso Liquido (kg)',
            itemCode: null,
            previousStatus: 'warning',
            evidenceHash: 'sha256:8f3a2c',
            resolutionNote:
              'Diferenca de peso liquido dentro da tolerancia de 2% acordada com o fiscal em 13/08.',
            acceptedAt: at(13, 17, 5),
            acceptedBy: 2,
            acceptedByName: 'Eduarda Lima',
          },
          {
            id: 702,
            scope: 'item',
            rowKey: 'item:sku-0007',
            fieldLabel: 'Comparativo por item',
            itemCode: 'SKU-0007',
            previousStatus: 'warning',
            evidenceHash: 'sha256:1b77e0',
            resolutionNote: 'SKU-0007 entrara no Espelho v4 apos correcao do fornecedor.',
            acceptedAt: at(14, 9, 30),
            acceptedBy: 3,
            acceptedByName: 'Odett Ferreira',
          },
        ]
      : [],
    aggregateComparison: full ? AGGREGATE_FULL : AGGREGATE_FULL.slice(0, 9),
    itemComparison: items,
    unmatchedPlItems: [
      {
        itemCode: 'SKU-0099',
        description: 'SACOLA PROMOCIONAL TNT (BRINDE)',
        quantity: 500,
        source: 'packing_list',
      },
      {
        itemCode: 'SKU-0100',
        description: 'DISPLAY DE BALCAO PAPELAO',
        quantity: 40,
        source: 'packing_list',
      },
    ],
    unmatchedInvoiceItems: [
      {
        itemCode: 'SKU-0012',
        description: 'MEIA INFANTIL CANO MEDIO ESTAMPA FOGUETE (DESCONTO FOC)',
        quantity: 120,
        source: 'invoice',
      },
    ],
    supplierFooterAliases: ['MEIYA', 'HUAXIN SOCKS', 'YIWU HUAXIN'],
    espelhoSuppliers: ['MEIYA', 'HUAXIN SOCKS', 'DONGYANG PACKAGING'],
    draftBlRevisions: full
      ? [
          {
            field: 'portOfDischarge',
            label: 'Porto Destino',
            draftValue: 'SANTOS, BR',
            finalValue: 'ITAPOA, BR',
            isRevised: true,
          },
          {
            field: 'totalBoxes',
            label: 'Total Caixas',
            draftValue: '412',
            finalValue: '418',
            isRevised: true,
          },
          {
            field: 'freeTime',
            label: 'Free Time',
            draftValue: null,
            finalValue: '14',
            isRevised: true,
          },
          {
            field: 'woodDeclaration',
            label: 'Declaracao Madeira',
            draftValue: 'Nao',
            finalValue: 'Sim',
            isRevised: true,
          },
          {
            field: 'cargoDescription',
            label: 'Descricao Carga',
            draftValue:
              '412 CARTONS OF SOCKS AND PAJAMAS\nHS 6115 / 6111\nORDER REF.: IMP-2026-001',
            finalValue: CARGO_DESCRIPTION,
            isRevised: true,
          },
        ]
      : [],
    invoiceConfidence: 0.93,
    plConfidence: 0.88,
    blConfidence: full ? 0.91 : 0.72,
    finalBlConfidence: full ? 0.91 : null,
    draftBlConfidence: 0.72,
    espelhoConfidence: full ? 0.97 : 0.55,
    espelhoSource: full ? 'upload' : 'auto_deterministic',
    extractionCoverage: {
      invoice: {
        readPercent: 90,
        effectiveReadPercent: 86,
        trackedMissingFields: ['shippedOnBoardDate'],
        missingFields: ['shippedOnBoardDate', 'exporterAddress'],
        lowConfidenceFields: ['exporterTaxId', 'manufacturerName'],
      },
      packingList: { readPercent: 100, missingFields: [], lowConfidenceFields: [] },
      bl: full
        ? { readPercent: 96, missingFields: ['sealNumber'], lowConfidenceFields: ['ncmList'] }
        : null,
      draftBl: {
        readPercent: 71,
        missingFields: ['freeTime', 'issueDate', 'voyageNumber', 'containerType', 'eta'],
        lowConfidenceFields: ['woodDeclaration', 'ncmList', 'etd'],
      },
    },
  };
}

// ── Proformas (/api/documents/process/:id/proformas) ────────────────────

function buildProformas(url: URL) {
  const p = idFrom(url);
  const items = PROFORMA_DATA.items as Array<Record<string, unknown>>;
  const proformas = [
    {
      documentId: p * 1000 + 7,
      filename:
        'PI-2026-0417_PROFORMA_INVOICE_MEIYA_KNITTING_PUKET_SS27_SOCKS_PAJAMAS_UNDERWEAR.pdf',
      fileUrl: `/api/documents/${p * 1000 + 7}/file`,
      uploadedAt: at(14, 10, 0, 5),
      confidence: 0.85,
      piNumber: 'PI-2026-0417',
      invoiceDate: '2026-05-14',
      validUntil: '2026-06-30',
      currency: 'USD',
      totalFobValue: 48250,
      paymentTerms: { depositPercent: 30, balancePercent: 70, paymentDays: 45 },
      itemCount: items.length,
      items,
      preConsLinked: true,
    },
    {
      documentId: p * 1000 + 13,
      filename: 'PI-2026-0418_PROFORMA_COMPLEMENTAR_BRINDES_E_DISPLAYS_scan.pdf',
      fileUrl: `/api/documents/${p * 1000 + 13}/file`,
      uploadedAt: at(20, 14, 0, 5),
      confidence: 0.42,
      piNumber: 'PI-2026-0418',
      invoiceDate: '2026-05-20',
      validUntil: null,
      currency: 'USD',
      totalFobValue: 1250,
      paymentTerms: null,
      itemCount: 0,
      items: [],
      preConsLinked: false,
    },
  ];
  return {
    processId: p,
    proformaCount: proformas.length,
    totals: {
      itemCount: proformas.reduce((a, pi) => a + pi.itemCount, 0),
      totalFobValue: proformas.reduce((a, pi) => a + (pi.totalFobValue ?? 0), 0),
    },
    proformas,
  };
}

// ── Espelho (/api/espelhos/:id) ─────────────────────────────────────────

const ESPELHO_DESCRIPTIONS = [
  'MEIA INFANTIL CANO MEDIO ALGODAO PENTEADO ESTAMPA DINOSSAURO — EAN 7891234500011',
  'MEIA INFANTIL CANO MEDIO ALGODAO PENTEADO ESTAMPA UNICORNIO — EAN 7891234500028',
  'MEIA ADULTO SAPATILHA INVISIVEL COM SILICONE NO CALCANHAR KIT 3 PARES — EAN 7891234500035',
  'PIJAMA INFANTIL LONGO MALHA PENTEADA ESTAMPA ESPACIAL COM BRILHO NO ESCURO — EAN 7891234500042',
  'CUECA BOXER INFANTIL ALGODAO COM ELASTANO KIT 2 PECAS — EAN 7891234500059',
  'NECESSAIRE INFANTIL NEOPRENE ESTAMPA TUBAROES — EAN 7891234500066',
  'MEIA CALCA INFANTIL FIO 40 LISA — EAN 7891234500073',
  'MEIA ADULTO CANO ALTO ALGODAO LISTRADA (MOSTRUARIO) — EAN 7891234500080',
];
const ESPELHO_NCMS = [
  '6115.95.00',
  '6115.95.00',
  '6115.96.00',
  '6111.20.00',
  '6212.10.00',
  '4202.92.00',
  '6115.29.90',
  '6115.95.00',
];
const ESPELHO_COLORS = [
  'AZUL MARINHO',
  'ROSA CHICLETE',
  'PRETO',
  'AZUL ROYAL',
  'SORTIDO',
  'VERDE',
  'BRANCO',
  'CINZA MESCLA',
];
const ESPELHO_SIZES = ['23-26', '27-30', '35-39', '4', '6', 'U', '2-4', '39-43'];

function buildEspelhoItems(processId: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const base = i % ESPELHO_DESCRIPTIONS.length;
    const quantity = n === 8 ? 60 : 900 + ((n * 137) % 2400);
    const unitPrice = n === 8 ? 0 : Number((1.2 + (n % 7) * 0.85).toFixed(2));
    return {
      id: processId * 10_000 + n,
      itemCode: `SKU-${String(n).padStart(4, '0')}`,
      description: `${ESPELHO_DESCRIPTIONS[base]}${n > 8 ? ` / LOTE ${Math.ceil(n / 8)}` : ''}`,
      color: ESPELHO_COLORS[base],
      size: ESPELHO_SIZES[base],
      ncm: ESPELHO_NCMS[base],
      unitPrice,
      quantity,
      totalPrice: Number((unitPrice * quantity).toFixed(2)),
      boxes: Math.max(1, Math.round(quantity / 60)),
      netWeight: Number((quantity * 0.12).toFixed(2)),
      grossWeight: Number((quantity * 0.13).toFixed(2)),
      isFoc: n === 8 || n === 16,
      requiresLi: base === 3,
      requiresCert: base === 3 || base === 4,
    };
  });
}

function buildEspelho(url: URL) {
  const p = idFrom(url);
  const items = buildEspelhoItems(p, isFull(url) ? 24 : 6);
  const totals = items.reduce(
    (acc, it) => {
      acc.totalFobValue += it.totalPrice;
      acc.totalQuantity += it.quantity;
      acc.totalBoxes += it.boxes;
      acc.totalNetWeight += it.netWeight;
      acc.totalGrossWeight += it.grossWeight;
      return acc;
    },
    { totalFobValue: 0, totalQuantity: 0, totalBoxes: 0, totalNetWeight: 0, totalGrossWeight: 0 },
  );
  return {
    id: 500 + p,
    processId: p,
    status: isFull(url) ? 'sent' : 'draft',
    items,
    ...totals,
    driveFileId: isFull(url) ? '1EspelhoDriveFileId-IMP-2026-001' : null,
    driveSentAt: isFull(url) ? at(13, 18, 2) : null,
    sentToFenicia: isFull(url),
    sentToFeniciaAt: isFull(url) ? at(14, 9, 47) : null,
    createdAt: at(13, 17, 30),
    updatedAt: at(14, 9, 47),
  };
}

// ── Eventos (/api/processes/:id/events) ─────────────────────────────────

function buildEvents(processId: number) {
  const seed: Array<
    [string, string, string | null, Record<string, unknown> | null, string | null, number]
  > = [
    [
      'process_created',
      'Processo criado',
      'Processo IMP-2026-001 criado a partir da linha 42 da planilha Pre_Cons (KIOM), marca Puket, fornecedor Meiya Knitting.',
      { source: 'pre_cons', sheet: 'SS27 - Meias', row: 42 },
      'Nicolas Matsuda',
      1,
    ],
    [
      'document_uploaded',
      'Proforma Invoice recebida por e-mail',
      'PI-2026-0417_PROFORMA_INVOICE_MEIYA_KNITTING_PUKET_SS27_SOCKS_PAJAMAS_UNDERWEAR.pdf classificada automaticamente como Proforma.',
      {
        documentId: 1007,
        source: 'email',
        emailSubject: 'PI 2026-0417 Puket SS27 - proforma for approval',
      },
      null,
      2,
    ],
    [
      'status_changed',
      'Status alterado: Rascunho → Documentos Recebidos',
      null,
      { from: 'draft', to: 'documents_received' },
      'Eduarda Lima',
      3,
    ],
    [
      'document_uploaded',
      'Invoice e Packing List recebidos',
      'Dois anexos processados do e-mail "Shipping docs IMP-2026-001 / MSKU7781234": Invoice (93%) e Packing List (88%).',
      { documentIds: [1001, 1003], source: 'email' },
      null,
      4,
    ],
    [
      'document_uploaded',
      'Draft BL recebido do agente de carga',
      'DRAFT_BL_MAEU2268841190_rev1_recebido_agente_carga.pdf — extracao com 66% de confianca; declaracao de madeira nao encontrada.',
      { documentId: 1006, source: 'email' },
      null,
      5,
    ],
    [
      'validation_run',
      'Validacao executada',
      '27 verificacoes: 12 conformes, 6 falhas, 5 atencoes, 4 bloqueadas por documento ausente.',
      { passed: 12, failed: 6, warnings: 5, skipped: 4, durationMs: 1840 },
      'Eduarda Lima',
      6,
    ],
    [
      'correction_needed',
      'E-mail de correcao gerado',
      'Rascunho para Zhejiang Meiya Knitting Co., Ltd. com 4 pontos: porto de descarga, volumes, CBM e NCMs no BL.',
      {
        communicationId: 9001,
        failedChecks: ['ports-match', 'box-quantity-match', 'cbm-match', 'ncm-bl-description'],
      },
      'Eduarda Lima',
      7,
    ],
    [
      'email_sent',
      'E-mail enviado ao fornecedor',
      'Assunto: IMP-2026-001 / PI-2026-0417 — Correction request: Invoice, Packing List and BL. Destinatarios: export@meiya-knitting.example.com, sales.assist@meiya-knitting.example.com.',
      { communicationId: 9001, messageId: '<a1b2c3@importacao.grupounico>' },
      'Eduarda Lima',
      8,
    ],
    [
      'draft_bl_checklist_changed',
      'Checklist do Draft BL: Exportador/Embarcador conferido',
      null,
      { key: 'exporterOk', checked: true },
      'Odett Ferreira',
      9,
    ],
    [
      'document_uploaded',
      'Draft BL revisado recebido',
      'DRAFT_BL_MAEU2268841190_rev2_corrigido_madeira_e_freetime_PUKET_IMP-2026-001.pdf substitui a rev1 como draft operacional.',
      { documentId: 1005, source: 'manual' },
      'Odett Ferreira',
      10,
    ],
    [
      'comparison_field_edited',
      'Valor editado no comparativo: Total Caixas (Invoice)',
      'De "421" para "412". Motivo: valor conferido no PDF original; a IA havia lido 421.',
      { rowKey: 'aggregate:total-caixas', sourceColumn: 'invoice', previous: '421', next: '412' },
      'Odett Ferreira',
      11,
    ],
    [
      'comparison_acceptance',
      'Divergencia aceita: Peso Liquido (kg)',
      'Diferenca de peso liquido dentro da tolerancia de 2% acordada com o fiscal em 13/08.',
      { rowKey: 'aggregate:peso-liquido-kg', previousStatus: 'warning' },
      'Eduarda Lima',
      12,
    ],
    [
      'espelho_generated',
      'Espelho gerado (v3)',
      '24 itens, FOB USD 48.190,00, 418 caixas. Enviado ao Drive na pasta do processo.',
      { espelhoId: 501, items: 24, driveFileId: '1EspelhoDriveFileId-IMP-2026-001' },
      'Eduarda Lima',
      13,
    ],
    [
      'status_changed',
      'Status alterado: Validando → Validado',
      null,
      { from: 'validating', to: 'validated' },
      'Eduarda Lima',
      14,
    ],
    [
      'logistic_status_changed',
      'Status logistico: Ag. Embarque → Em Transito',
      'Navio MAERSK LOTA 632W zarpou de Ningbo em 05/08. ETA Itapoa 12/09.',
      { from: 'waiting_shipment', to: 'in_transit', vessel: 'MAERSK LOTA', eta: '2026-09-12' },
      null,
      15,
    ],
    [
      'document_uploaded',
      'BL original (OHBL) recebido',
      'OHBL_MAEU2268841190_MAERSK_LOTA_632W_NINGBO-ITAPOA_ORIGINAL_BILL_OF_LADING_PUKET_IMP-2026-001.pdf — 91% de confianca. Dados do Draft BL passam a ser historico.',
      { documentId: 1004, source: 'email' },
      null,
      16,
    ],
    [
      'checklist_step_changed',
      'Checklist documental: Enviar Invoice Fenicia concluido',
      null,
      { step: 'invoiceSentFeniciaAt' },
      'Odett Ferreira',
      17,
    ],
    [
      'email_sent',
      'Espelho enviado a Fenicia',
      'Espelho v3 e documentos (Invoice, PL, OHBL) enviados para despacho@fenicia.example.com.',
      { communicationId: 9004, attachments: 4 },
      'Eduarda Lima',
      18,
    ],
    [
      'alert',
      'Alerta: prazo de LI em 5 dias',
      'A LI 26-1234567-8 ainda esta pendente; prazo limite 20/09/2026 para nao atrasar o registro da DUIMP.',
      { severity: 'warning', liDeadline: '2026-09-20' },
      null,
      19,
    ],
  ];
  const events = seed.map(([eventType, title, description, metadata, userName, order], i) => ({
    id: processId * 1000 + i + 1,
    processId,
    eventType,
    title,
    description,
    metadata,
    createdBy: userName
      ? userName === 'Nicolas Matsuda'
        ? 1
        : userName === 'Eduarda Lima'
          ? 2
          : 3
      : null,
    createdAt: at(1 + order, 8 + (order % 9), (order * 7) % 60),
    userName,
  }));
  // Mais recente primeiro, como o backend devolve.
  return events.reverse();
}

const EVENTS_FULL = buildEvents(1);

// ── Checklist do Draft BL / etapas / registros operacionais ──────────────

const DRAFT_BL_CHECKLIST: Record<
  string,
  {
    checked: boolean;
    timestamp: string | null;
    checkedBy: number | null;
    checkedByName: string | null;
  }
> = {
  draftReceivedOk: {
    checked: true,
    timestamp: at(9, 10, 12),
    checkedBy: 3,
    checkedByName: 'Odett Ferreira',
  },
  exporterOk: {
    checked: true,
    timestamp: at(9, 10, 15),
    checkedBy: 3,
    checkedByName: 'Odett Ferreira',
  },
  consigneeOk: {
    checked: true,
    timestamp: at(9, 10, 16),
    checkedBy: 3,
    checkedByName: 'Odett Ferreira',
  },
  descriptionOk: {
    checked: true,
    timestamp: at(9, 10, 40),
    checkedBy: 2,
    checkedByName: 'Eduarda Lima',
  },
  referenceOk: { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
  ncmsOk: { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
  woodOk: { checked: true, timestamp: at(10, 9, 5), checkedBy: 2, checkedByName: 'Eduarda Lima' },
  freeTimeOk: {
    checked: true,
    timestamp: at(10, 9, 6),
    checkedBy: 2,
    checkedByName: 'Eduarda Lima',
  },
  weightCbmOk: { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
  freightOk: {
    checked: true,
    timestamp: at(10, 9, 30),
    checkedBy: 3,
    checkedByName: 'Odett Ferreira',
  },
  containersOk: { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
};

function buildCustomStages(processId: number) {
  return [
    {
      id: processId * 10 + 1,
      processId,
      label: 'Vistoria INMETRO do pijama infantil no CD',
      position: 1,
      completedAt: at(3, 14, 20),
      notes: 'Agendada com o OCP-0042; amostras separadas na conferencia previa.',
      createdAt: at(1, 9),
    },
    {
      id: processId * 10 + 2,
      processId,
      label: 'Confirmar free time de 14 dias com o armador',
      position: 2,
      completedAt: at(10, 9, 6),
      notes: null,
      createdAt: at(2, 9),
    },
    {
      id: processId * 10 + 3,
      processId,
      label: 'Solicitar retificacao do CBM no BL (61,20 → 58,40)',
      position: 3,
      completedAt: null,
      notes:
        'Aguardando retorno do agente de carga desde 14/08. Sem retificacao a DUIMP sera registrada com o valor do BL.',
      createdAt: at(14, 11),
    },
    {
      id: processId * 10 + 4,
      processId,
      label: 'Enviar amostras para laboratorio (composicao textil)',
      position: 4,
      completedAt: null,
      notes: null,
      createdAt: at(15, 16),
    },
  ];
}

function buildOperationalRecords(processId: number) {
  return [
    {
      id: processId * 100 + 1,
      processId,
      recordKind: 'document_error' as const,
      recordType: 'porto',
      quantity: 1,
      amount: null,
      currency: null,
      notes: 'Porto de descarga divergente entre Invoice (Santos) e BL (Itapoa).',
      createdAt: at(12, 15),
    },
    {
      id: processId * 100 + 2,
      processId,
      recordKind: 'document_error' as const,
      recordType: 'pl_volumes',
      quantity: 1,
      amount: null,
      currency: null,
      notes: 'Invoice com 412 caixas contra 418 do Packing List; brindes nao faturados.',
      createdAt: at(12, 15, 4),
    },
    {
      id: processId * 100 + 3,
      processId,
      recordKind: 'document_error' as const,
      recordType: 'ncm',
      quantity: 2,
      amount: null,
      currency: null,
      notes: 'NCMs 6212 e 4202 ausentes na descricao do BL.',
      createdAt: at(12, 15, 9),
    },
    {
      id: processId * 100 + 4,
      processId,
      recordKind: 'extra_cost' as const,
      recordType: 'LAVAÇÃO E REPARO',
      quantity: null,
      amount: '1850.00',
      currency: 'BRL',
      notes:
        'Container MSKU7781234 devolvido com residuo de fita adesiva e amassado na porta esquerda; cobranca do armador.',
      createdAt: at(28, 10, 30, 9),
    },
    {
      id: processId * 100 + 5,
      processId,
      recordKind: 'extra_cost' as const,
      recordType: 'ARMAZENAGEM',
      quantity: null,
      amount: '4120.75',
      currency: 'BRL',
      notes: 'Diarias adicionais no porto por atraso na liberacao da LI (3 dias).',
      createdAt: at(30, 9, 0, 9),
    },
    {
      id: processId * 100 + 6,
      processId,
      recordKind: 'extra_cost' as const,
      recordType: 'DEMURRAGE',
      quantity: null,
      amount: '350.00',
      currency: 'USD',
      notes: null,
      createdAt: at(2, 9, 0, 10),
    },
  ];
}

// ── Follow-Up (/api/follow-up/:id) ──────────────────────────────────────

function buildFollowUp(url: URL) {
  const p = idFrom(url);
  const full = isFull(url);
  return {
    id: 300 + p,
    processId: p,
    documentsReceivedAt: at(8, 12, 30),
    preInspectionAt: at(9, 10, 12),
    savedToFolderAt: at(9, 10, 50),
    ncmVerifiedAt: at(11, 14, 0),
    ncmBlCheckedAt: full ? at(12, 9, 15) : null,
    freightBlCheckedAt: full ? at(12, 9, 20) : null,
    espelhoBuiltAt: full ? at(13, 17, 30) : null,
    invoiceSentFeniciaAt: full ? at(13, 18, 10) : null,
    espelhoGeneratedAt: full ? at(13, 17, 30) : null,
    signaturesCollectedAt: full ? at(14, 11, 0) : null,
    signedDocsSentAt: null,
    sentToFeniciaAt: full ? at(14, 9, 47) : null,
    diDraftAt: null,
    liSubmittedAt: full ? at(14, 16, 0) : null,
    liApprovedAt: null,
    liDeadline: '2026-09-20',
    overallProgress: full ? 73 : 27,
    notes: full
      ? 'Processo prioritario para a colecao SS27 (janela de loja 05/10).\n\nPendencias:\n- Retificacao do CBM no BL solicitada em 14/08 ao agente de carga; sem retorno.\n- LI do pijama infantil (INMETRO) protocolada em 14/08, prazo 20/09.\n- Fornecedor confirmou por e-mail que a Invoice sera reemitida com 418 caixas e porto Itapoa.\n\nObservacao fiscal (Eduarda, 13/08): diferenca de USD 60,00 no FOB aceita como desconto FOC; nao gerar nova validacao.'
      : null,
    createdAt: at(1, 9),
    updatedAt: at(14, 16),
    stepCompletedBy: {
      documentsReceivedAt: {
        completedBy: 2,
        completedByName: 'Eduarda Lima',
        completedAt: at(8, 12, 30),
      },
      preInspectionAt: {
        completedBy: 3,
        completedByName: 'Odett Ferreira',
        completedAt: at(9, 10, 12),
      },
      ncmVerifiedAt: {
        completedBy: 3,
        completedByName: 'Odett Ferreira',
        completedAt: at(11, 14, 0),
      },
      invoiceSentFeniciaAt: {
        completedBy: 3,
        completedByName: 'Odett Ferreira',
        completedAt: at(13, 18, 10),
      },
      sentToFeniciaAt: {
        completedBy: 2,
        completedByName: 'Eduarda Lima',
        completedAt: at(14, 9, 47),
      },
    },
  };
}

// ── Cambio (/api/currency-exchange/process/:id[/totals]) ────────────────

function buildExchanges(processId: number) {
  return [
    {
      id: processId * 10 + 1,
      processId,
      type: 'deposit' as const,
      amountUsd: '14475.00',
      exchangeRate: '5.2140',
      amountBrl: '75472.65',
      paymentDeadline: '2026-05-30',
      expirationDate: null,
      notes: 'Sinal de 30% da PI-2026-0417, contrato de cambio 26/0451 (Banco do Brasil).',
      createdAt: at(28, 10, 0, 5),
    },
    {
      id: processId * 10 + 2,
      processId,
      type: 'balance' as const,
      amountUsd: '33775.00',
      exchangeRate: null,
      amountBrl: null,
      paymentDeadline: '2026-09-19',
      expirationDate: '2026-10-19',
      notes:
        'Saldo de 70% a fechar apos chegada; cotacao travada em 5,40 ate 19/09 conforme mesa de cambio.',
      createdAt: at(14, 11, 0),
    },
    {
      id: processId * 10 + 3,
      processId,
      type: 'balance' as const,
      amountUsd: '3850.00',
      exchangeRate: '5.4321',
      amountBrl: '20913.59',
      paymentDeadline: '2026-08-20',
      expirationDate: '2026-09-20',
      notes: 'Frete prepaid reembolsado ao agente.',
      createdAt: at(18, 15, 30),
    },
    {
      id: processId * 10 + 4,
      processId,
      type: 'deposit' as const,
      amountUsd: '375.00',
      exchangeRate: '5.3900',
      amountBrl: '2021.25',
      paymentDeadline: '2026-06-05',
      expirationDate: null,
      notes: null,
      createdAt: at(2, 9, 0, 6),
    },
  ];
}

function buildExchangeTotals(url: URL) {
  const exchanges = isFull(url)
    ? buildExchanges(idFrom(url))
    : buildExchanges(idFrom(url)).slice(0, 1);
  const sum = (type: 'deposit' | 'balance', field: 'amountUsd' | 'amountBrl') =>
    exchanges
      .filter((e) => e.type === type)
      .reduce((acc, e) => acc + Number(e[field] ?? 0), 0)
      .toFixed(2);
  return {
    exchanges,
    totals: {
      totalBalanceUsd: sum('balance', 'amountUsd'),
      totalBalanceBrl: sum('balance', 'amountBrl'),
      totalDepositUsd: sum('deposit', 'amountUsd'),
      totalDepositBrl: sum('deposit', 'amountBrl'),
    },
  };
}

// ── E-mails (/api/email-ingestion/logs e /status) ───────────────────────

const EMAIL_LOGS = [
  {
    id: 41,
    messageId: '<pi-0417@meiya>',
    fromAddress: 'Lily Chen - Meiya Export <export@meiya-knitting.example.com>',
    subject:
      'PI 2026-0417 Puket SS27 - proforma for approval (socks / pajamas / underwear / neoprene pouches)',
    receivedAt: at(14, 10, 0, 5),
    bodyText:
      'Dear Eduarda,\n\nPlease find attached the proforma invoice PI-2026-0417 for the SS27 order.\n\nPayment terms: 30% deposit, 70% balance 45 days after B/L date.\nDelivery: cargo ready by end of July, shipment from Ningbo.\n\nKindly confirm so we can start production.\n\nBest regards,\nLily Chen',
    status: 'completed' as const,
    attachmentsCount: 1,
    processedAttachments: 1,
    processedAttachmentDetails: [
      {
        filename:
          'PI-2026-0417_PROFORMA_INVOICE_MEIYA_KNITTING_PUKET_SS27_SOCKS_PAJAMAS_UNDERWEAR.pdf',
        type: 'proforma_invoice',
        documentId: 1007,
      },
    ],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(14, 10, 1, 5),
  },
  {
    id: 42,
    messageId: '<docs-001@meiya>',
    fromAddress: 'Lily Chen - Meiya Export <export@meiya-knitting.example.com>',
    subject:
      'Shipping docs IMP-2026-001 / MSKU7781234 — commercial invoice + packing list (MAERSK LOTA 632W, ETD Aug 2)',
    receivedAt: at(8, 12, 30),
    bodyText:
      'Dear Eduarda,\n\nAttached the commercial invoice and packing list for container MSKU7781234.\nVessel MAERSK LOTA V.632W, ETD Ningbo Aug 2nd, ETA Santos Sep 10th.\n\nDraft B/L will follow from the forwarder.\n\nBest regards,\nLily Chen',
    status: 'completed' as const,
    attachmentsCount: 3,
    processedAttachments: 2,
    processedAttachmentDetails: [
      {
        filename:
          'MY-INV-2026-08842_COMMERCIAL_INVOICE_PUKET_IMP-2026-001_ORDER_PI-2026-0417_REV2_FINAL_SIGNED.pdf',
        type: 'invoice',
        documentId: 1001,
      },
      {
        filename: 'MY-PL-2026-08842_PACKING_LIST_PUKET_IMP-2026-001_418CTNS_MSKU7781234.pdf',
        type: 'packing_list',
        documentId: 1003,
      },
      { filename: 'logo_meiya.png', type: 'ignored', documentId: null },
    ],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(8, 12, 31),
  },
  {
    id: 43,
    messageId: '<draft-bl-rev1@fwd>',
    fromAddress: 'ops.ningbo@globalfreight-forwarder.example.com',
    subject: 'DRAFT BL MAEU2268841190 for approval - PUKET IMP-2026-001 - please revert within 24h',
    receivedAt: at(5, 16, 45),
    bodyText: null,
    status: 'completed' as const,
    attachmentsCount: 1,
    processedAttachments: 1,
    processedAttachmentDetails: [
      {
        filename: 'DRAFT_BL_MAEU2268841190_rev1_recebido_agente_carga.pdf',
        type: 'draft_bl',
        documentId: 1006,
      },
    ],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(5, 16, 46),
  },
  {
    id: 44,
    messageId: '<ohbl@fwd>',
    fromAddress: 'ops.ningbo@globalfreight-forwarder.example.com',
    subject:
      'ORIGINAL BL MAEU2268841190 issued - MAERSK LOTA 632W sailed Aug 5 - PUKET IMP-2026-001',
    receivedAt: at(12, 8, 5),
    bodyText:
      'Hi team,\n\nOriginal B/L MAEU2268841190 issued and attached. Vessel sailed Aug 5th, ETA Itapoa Sep 12th.\nNote: POD changed to ITAPOA as per shipper instruction.\n\nRegards,\nGlobal Freight Forwarder — Ningbo ops',
    status: 'completed' as const,
    attachmentsCount: 1,
    processedAttachments: 1,
    processedAttachmentDetails: [
      {
        filename:
          'OHBL_MAEU2268841190_MAERSK_LOTA_632W_NINGBO-ITAPOA_ORIGINAL_BILL_OF_LADING_PUKET_IMP-2026-001.pdf',
        type: 'ohbl',
        documentId: 1004,
      },
    ],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(12, 8, 6),
  },
  {
    id: 45,
    messageId: '<cert@ocp>',
    fromAddress: 'certificacao@ocp0042.example.com.br',
    subject:
      'Certificado de conformidade INMETRO - pijama infantil - processo IMP-2026-001 (frente e verso digitalizados)',
    receivedAt: at(11, 15, 20),
    bodyText:
      'Prezados,\n\nSegue o certificado de conformidade digitalizado. A via original sera enviada por Sedex.\n\nAtenciosamente,\nOCP-0042',
    status: 'failed' as const,
    attachmentsCount: 1,
    processedAttachments: 0,
    processedAttachmentDetails: [],
    processCode: PROCESS_CODE_1,
    errorMessage:
      'Extracao do anexo CERTIFICADO_CONFORMIDADE_INMETRO_PIJAMA_INFANTIL_OCP-0042_2026_scan_frente_verso.pdf falhou: documento escaneado em baixa resolucao.',
    createdAt: at(11, 15, 21),
  },
  {
    id: 46,
    messageId: '<reply-corr@meiya>',
    fromAddress: 'Lily Chen - Meiya Export <export@meiya-knitting.example.com>',
    subject: 'RE: IMP-2026-001 / PI-2026-0417 — Correction request: Invoice, Packing List and BL',
    receivedAt: at(15, 9, 10),
    bodyText:
      'Dear Eduarda,\n\nNoted with thanks. We will reissue the invoice with 418 cartons and POD Itapoa. The forwarder will amend the B/L description to include HS 6212 and 4202.\n\nCBM: the 61.20 on the B/L is the carrier measurement; the packing list 58.40 is our calculation. Please advise which one you need.\n\nBest regards,\nLily Chen',
    status: 'reprocessed' as const,
    attachmentsCount: 0,
    processedAttachments: 0,
    processedAttachmentDetails: [],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(15, 9, 11),
  },
  {
    id: 47,
    messageId: '<agent-freetime@fwd>',
    fromAddress: 'ops.ningbo@globalfreight-forwarder.example.com',
    subject: 'RE: free time and wood declaration - MAEU2268841190',
    receivedAt: at(15, 14, 0),
    bodyText: null,
    status: 'processing' as const,
    attachmentsCount: 1,
    processedAttachments: 0,
    processedAttachmentDetails: [],
    processCode: PROCESS_CODE_1,
    errorMessage: null,
    createdAt: at(15, 14, 1),
  },
  {
    id: 48,
    messageId: '<newsletter@maersk>',
    fromAddress: 'noreply@maersk-notifications.example.com',
    subject: 'Vessel schedule update — MAERSK LOTA 632W',
    receivedAt: at(16, 6, 0),
    bodyText: null,
    status: 'ignored' as const,
    attachmentsCount: 0,
    processedAttachments: 0,
    processedAttachmentDetails: [],
    processCode: null,
    errorMessage: null,
    createdAt: at(16, 6, 1),
  },
  {
    id: 49,
    messageId: '<pending@unknown>',
    fromAddress: 'financeiro@transportadora-xyz.example.com.br',
    subject: 'Fatura de frete rodoviario Itapoa → CD Sao Paulo (aguardando vinculo com processo)',
    receivedAt: at(16, 11, 30),
    bodyText: null,
    status: 'pending' as const,
    attachmentsCount: 2,
    processedAttachments: 0,
    processedAttachmentDetails: [],
    processCode: null,
    errorMessage: null,
    createdAt: at(16, 11, 31),
  },
];

const EMAIL_STATUS = {
  enabled: true,
  method: 'gmail_api',
  gmailConfigured: true,
  imapConfigured: false,
  sharedMailbox: 'importacao@grupounico.example.com',
  allowedSendersConfigured: true,
  allowedSendersCount: 6,
  allowedSenders: '6 remetente(s) autorizado(s)',
  lastRun: at(16, 11, 45),
  todayStats: [
    { status: 'completed', count: 4 },
    { status: 'failed', count: 1 },
    { status: 'pending', count: 1 },
  ],
};

// ── Atendimentos (/api/communications/process/:id) ──────────────────────

function buildCommunications(processId: number) {
  return [
    {
      id: 9005,
      processId,
      recipient: 'Global Freight Forwarder — Ningbo ops',
      recipientEmail: 'ops.ningbo@globalfreight-forwarder.example.com',
      subject:
        'IMP-2026-001 / MAEU2268841190 — request to amend B/L description (HS 6212 and 4202) and confirm CBM 58,40 m3',
      body: 'Hi team,\n\nFollowing the shipper reply on the correction request, please amend the B/L description to include HS codes 6212.10.00 and 4202.92.00 and confirm whether the CBM can be corrected to 58.40 m3 (packing list) instead of 61.20 m3.\n\nWe need the amended B/L before customs registration (DUIMP) on Sep 14.\n\nThanks,\nEduarda',
      status: 'draft' as const,
      sentAt: null,
      errorMessage: null,
      attachments: [
        {
          filename: 'MY-PL-2026-08842_PACKING_LIST_PUKET_IMP-2026-001_418CTNS_MSKU7781234.pdf',
          documentId: processId * 1000 + 3,
        },
      ],
      createdAt: at(15, 10, 20),
    },
    {
      id: 9004,
      processId,
      recipient: 'Fenicia Despachos Aduaneiros',
      recipientEmail: 'despacho@fenicia.example.com, conferencia@fenicia.example.com',
      subject:
        'IMP-2026-001 — Espelho v3 e documentos para conferencia (Invoice, Packing List, OHBL) — Puket SS27 / Meiya',
      body: 'Prezados,\n\nSegue o espelho de importacao v3 do processo IMP-2026-001 (24 itens, FOB USD 48.190,00, 418 volumes, container 40HC MSKU7781234) e os documentos para conferencia.\n\nPontos de atencao:\n1. Porto de descarga alterado para Itapoa (BL original).\n2. CBM do BL (61,20) diverge do Packing List (58,40) — retificacao solicitada ao agente.\n3. Pijama infantil sujeito a LI/INMETRO (LI 26-1234567-8 protocolada em 14/08).\n\nQualquer duvida, estamos a disposicao.\n\nAtenciosamente,\nEduarda Lima',
      status: 'sent' as const,
      sentAt: at(14, 9, 47),
      errorMessage: null,
      attachments: [
        {
          filename:
            'ESPELHO_IMPORTACAO_PUKET_IMP-2026-001_MEIYA_v3_conferido_fiscal_2026-08-13.xlsx',
          espelhoId: 501,
        },
        {
          filename:
            'MY-INV-2026-08842_COMMERCIAL_INVOICE_PUKET_IMP-2026-001_ORDER_PI-2026-0417_REV2_FINAL_SIGNED.pdf',
          documentId: processId * 1000 + 1,
        },
        {
          filename: 'MY-PL-2026-08842_PACKING_LIST_PUKET_IMP-2026-001_418CTNS_MSKU7781234.pdf',
          documentId: processId * 1000 + 3,
        },
        {
          filename:
            'OHBL_MAEU2268841190_MAERSK_LOTA_632W_NINGBO-ITAPOA_ORIGINAL_BILL_OF_LADING_PUKET_IMP-2026-001.pdf',
          documentId: processId * 1000 + 4,
        },
      ],
      createdAt: at(14, 9, 30),
    },
    {
      id: 9003,
      processId,
      recipient: 'OCP-0042 Certificacao',
      recipientEmail: 'certificacao@ocp0042.example.com.br',
      subject:
        'Certificado INMETRO pijama infantil — solicitar reenvio em PDF nativo (o scan recebido nao e legivel)',
      body: 'Prezados,\n\nO certificado recebido em 11/08 esta em baixa resolucao e nao pode ser lido pelo nosso sistema. Poderiam reenviar em PDF gerado digitalmente?\n\nObrigada,\nOdett',
      status: 'failed' as const,
      sentAt: null,
      errorMessage:
        'SMTP 550 5.1.1: caixa certificacao@ocp0042.example.com.br nao existe. Verifique o endereco do destinatario.',
      attachments: null,
      createdAt: at(12, 11, 5),
    },
    {
      id: 9002,
      processId,
      recipient: 'Zhejiang Meiya Knitting Co., Ltd.',
      recipientEmail: 'export@meiya-knitting.example.com',
      subject: 'IMP-2026-001 — reminder: revised documents due Friday',
      body: 'Dear Lily,\n\nGentle reminder that we are waiting for the revised invoice and B/L as per our correction request of Aug 12.\n\nBest regards,\nEduarda',
      status: 'sent' as const,
      sentAt: at(14, 16, 2),
      errorMessage: null,
      attachments: null,
      createdAt: at(14, 16, 0),
    },
    {
      id: 9001,
      processId,
      recipient: 'Zhejiang Meiya Knitting Co., Ltd.',
      recipientEmail: 'export@meiya-knitting.example.com, sales.assist@meiya-knitting.example.com',
      subject: 'IMP-2026-001 / PI-2026-0417 — Correction request: Invoice, Packing List and BL',
      body: 'Dear Meiya team,\n\nWhile reviewing the shipping documents for order IMP-2026-001 we found the following discrepancies that must be corrected before customs clearance in Brazil:\n\n1. Port of discharge: Invoice states Santos, BL states Itapoa.\n2. Number of packages: Invoice 412 cartons vs Packing List/BL 418 cartons.\n3. CBM: Packing List 58.40 m3 vs BL 61.20 m3.\n4. NCM codes on BL: 6212 and 4202 are missing from the BL description.\n\nPlease send the revised documents by Friday.\n\nBest regards,\nEduarda Lima\nImportacao — Grupo Uni.co',
      status: 'sent' as const,
      sentAt: at(12, 14, 30),
      errorMessage: null,
      attachments: [
        {
          filename:
            'MY-INV-2026-08842_COMMERCIAL_INVOICE_PUKET_IMP-2026-001_ORDER_PI-2026-0417_REV2_FINAL_SIGNED.pdf',
          documentId: processId * 1000 + 1,
        },
      ],
      createdAt: at(12, 14, 10),
    },
    {
      id: 9000,
      processId,
      recipient: 'Meiya Export',
      recipientEmail: 'export@meiya-knitting.example.com',
      subject: 'PI-2026-0417 approved — please proceed with production',
      body: 'Dear Lily,\n\nPI-2026-0417 is approved. Deposit of 30% will be wired this week.\n\nBest regards,\nEduarda',
      status: 'sent' as const,
      sentAt: at(18, 11, 0, 5),
      errorMessage: null,
      attachments: null,
      createdAt: at(18, 10, 55, 5),
    },
  ];
}

// ── Pre-Cons (/api/pre-cons/process/:code e /divergences) ───────────────

function buildPreConsItems(processCode: string) {
  const supplier = 'ZHEJIANG MEIYA KNITTING CO., LTD.';
  return INVOICE_ITEMS.slice(0, 7).map((it, i) => ({
    id: 8000 + i,
    processCode,
    productName: it.description,
    itemCode: it.itemCode,
    quantity: it.quantity,
    agreedPrice: piUnitPrice(it).toFixed(2),
    ncmCode: it.ncmCode.replace(/\./g, ''),
    amount: (piUnitPrice(it) * it.quantity).toFixed(2),
    cbm: (it.quantity * 0.0041).toFixed(3),
    etd: '2026-08-02',
    eta: '2026-09-10',
    cargoReadyDate: '2026-07-25',
    piNumber: 'PI-2026-0417',
    ean13: it.ean,
    color: it.color,
    collection: 'SS27',
    portOfLoading: 'NINGBO',
    supplier,
    sheetName: 'SS27 - Meias e Pijamas',
  }));
}

const PRE_CONS_DIVERGENCES = [
  {
    processCode: PROCESS_CODE_1,
    field: 'totalFobValue',
    preConsValue: '$45,820.00',
    systemValue: '$48,250.00',
    severity: 'critical' as const,
  },
  {
    processCode: PROCESS_CODE_1,
    field: 'totalCbm',
    preConsValue: '58.40',
    systemValue: '55.00',
    severity: 'warning' as const,
  },
  {
    processCode: PROCESS_CODE_1,
    field: 'etd',
    preConsValue: '2026-08-02',
    systemValue: '2026-08-05',
    severity: 'info' as const,
  },
  {
    processCode: PROCESSES[1]?.processCode ?? 'IMP-2026-0002 PUKET',
    field: 'totalFobValue',
    preConsValue: '$12,000.00',
    systemValue: '$11,400.00',
    severity: 'warning' as const,
  },
];

// ── Configuracoes usadas pelas abas de atendimento/validacao ─────────────

const EMAIL_SIGNATURES = [
  {
    id: 1,
    name: 'Importacao — padrao',
    signatureHtml:
      '<p><strong>Eduarda Lima</strong><br/>Importacao | Grupo Uni.co<br/>importacao@grupounico.example.com</p>',
    isDefault: true,
    createdAt: at(1, 9, 0, 1),
    updatedAt: at(1, 9, 0, 1),
  },
  {
    id: 2,
    name: 'Fiscal — Odett',
    signatureHtml: '<p><strong>Odett Ferreira</strong><br/>Fiscal | Grupo Uni.co</p>',
    isDefault: false,
    createdAt: at(1, 9, 0, 1),
    updatedAt: at(1, 9, 0, 1),
  },
];

const COMMUNICATION_TEMPLATES = [
  {
    id: 1,
    name: 'Correcao de documentos (EN)',
    recipient: null,
    recipientEmail: null,
    subject: '{{processCode}} — Correction request',
    body: 'Dear team,\n\nPlease correct the following points:\n\n1.\n2.\n\nBest regards,',
    isActive: true,
    createdAt: at(1, 9, 0, 1),
    updatedAt: at(1, 9, 0, 1),
  },
  {
    id: 2,
    name: 'Envio a Fenicia',
    recipient: 'Fenicia Despachos Aduaneiros',
    recipientEmail: 'despacho@fenicia.example.com',
    subject: '{{processCode}} — Espelho e documentos',
    body: 'Prezados,\n\nSegue o espelho e os documentos do processo.\n\nAtenciosamente,',
    isActive: true,
    createdAt: at(1, 9, 0, 1),
    updatedAt: at(1, 9, 0, 1),
  },
];

// ── Handlers ────────────────────────────────────────────────────────────

export const processDetailHandlers: FixtureHandler[] = [
  // Validacao
  { path: /^\/api\/validation\/\d+$/, body: (url: URL) => ok(checksFor(url)) },
  { path: /^\/api\/validation\/\d+\/report$/, body: (url: URL) => ok(buildReport(url)) },
  {
    path: /^\/api\/validation\/\d+\/run$/,
    method: 'POST',
    body: (url: URL) => ok({ processId: idFrom(url), results: checksFor(url), ranAt: at(16, 12) }),
  },
  { path: /^\/api\/validation\/\d+\/anomalies$/, method: 'POST', body: ok(ANOMALIES) },
  {
    path: /^\/api\/validation\/\d+\/correction-draft$/,
    method: 'POST',
    body: (url: URL) => ok({ ...CORRECTION_DRAFT, processId: idFrom(url) }),
  },

  // Documentos
  {
    path: '/api/documents/source-policy',
    body: ok({
      source: 'both',
      driveOnly: false,
      driveIngestionEnabled: true,
      emailIngestionEnabled: true,
      manualUploadEnabled: true,
    }),
  },
  { path: /^\/api\/documents\/process\/\d+$/, body: (url: URL) => ok(documentsFor(url)) },
  {
    path: /^\/api\/documents\/process\/\d+\/comparison$/,
    body: (url: URL) => ok(buildComparison(url)),
  },
  {
    path: /^\/api\/documents\/process\/\d+\/proformas$/,
    body: (url: URL) => ok(buildProformas(url)),
  },

  // Espelho
  { path: /^\/api\/espelhos\/\d+$/, body: (url: URL) => ok(buildEspelho(url)) },
  { path: /^\/api\/espelhos\/\d+\/items$/, body: (url: URL) => ok(buildEspelho(url).items) },

  // Sub-recursos do processo
  {
    path: /^\/api\/processes\/\d+\/events$/,
    body: (url: URL) => {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
      const events = isFull(url) ? EVENTS_FULL : buildEvents(idFrom(url)).slice(0, 8);
      return ok(events.slice(0, limit));
    },
  },
  {
    path: /^\/api\/processes\/\d+\/draft-bl-checklist$/,
    body: (url: URL) =>
      ok(
        isFull(url)
          ? DRAFT_BL_CHECKLIST
          : Object.fromEntries(
              Object.entries(DRAFT_BL_CHECKLIST).map(([key, state], i) => [
                key,
                i < 2
                  ? state
                  : { checked: false, timestamp: null, checkedBy: null, checkedByName: null },
              ]),
            ),
      ),
  },
  {
    path: /^\/api\/processes\/\d+\/custom-stages$/,
    body: (url: URL) =>
      ok(isFull(url) ? buildCustomStages(1) : buildCustomStages(idFrom(url)).slice(0, 1)),
  },
  {
    path: /^\/api\/processes\/\d+\/operational-records$/,
    body: (url: URL) => ok(isFull(url) ? buildOperationalRecords(1) : []),
  },

  // Follow-Up
  { path: /^\/api\/follow-up\/\d+$/, body: (url: URL) => ok(buildFollowUp(url)) },

  // Cambio
  {
    path: /^\/api\/currency-exchange\/process\/\d+\/totals$/,
    body: (url: URL) => ok(buildExchangeTotals(url)),
  },
  {
    path: /^\/api\/currency-exchange\/process\/\d+$/,
    body: (url: URL) => ok(buildExchangeTotals(url).exchanges),
  },

  // E-mails: com `processId` devolve os vinculados ao processo; sem, a lista
  // geral (DashboardPage e a tela de e-mails tambem chamam esta rota).
  {
    path: '/api/email-ingestion/logs',
    body: (url: URL) => {
      const processId = url.searchParams.get('processId');
      const status = url.searchParams.get('status');
      let logs = EMAIL_LOGS;
      if (processId) {
        logs =
          Number(processId) === 1
            ? EMAIL_LOGS.filter((l) => l.processCode === PROCESS_CODE_1)
            : EMAIL_LOGS.slice(1, 3);
      }
      if (status) logs = logs.filter((l) => l.status === status);
      return paginated(logs, url);
    },
  },
  { path: '/api/email-ingestion/status', body: ok(EMAIL_STATUS) },

  // Atendimentos
  {
    path: /^\/api\/communications\/process\/\d+$/,
    body: (url: URL) => {
      const comms = isFull(url)
        ? buildCommunications(1)
        : buildCommunications(idFrom(url)).slice(3, 5);
      return paginated(comms, url);
    },
  },

  // Pre-Cons (o codigo vem do proprio path, entao sempre casa com o processo)
  {
    path: /^\/api\/pre-cons\/process\/[^/]+$/,
    body: (url: URL) => {
      const code = decodeURIComponent(url.pathname.split('/').pop() ?? PROCESS_CODE_1);
      return ok(buildPreConsItems(code));
    },
  },
  { path: '/api/pre-cons/divergences', body: ok(PRE_CONS_DIVERGENCES) },

  // Configuracoes lidas pelas abas Atendimentos e Checklist de validacao.
  { path: '/api/settings/email-signatures', body: ok(EMAIL_SIGNATURES) },
  { path: '/api/settings/communication-templates', body: ok(COMMUNICATION_TEMPLATES) },
];
