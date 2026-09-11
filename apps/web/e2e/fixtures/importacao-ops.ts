/**
 * Fixtures das telas operacionais da importacao para a auditoria responsiva.
 *
 * Cobre Pre-conferencia, SYDLE, Atendimentos, Ingestao de e-mail, Auditoria,
 * Configuracoes e Assistente. Os dados sao ficticios e propositalmente
 * "pesados": nomes e assuntos longos, todos os enums, valores grandes e nulos,
 * para estressar o layout. Os shapes seguem as interfaces declaradas em cada
 * pagina consumidora (`src/features/**`).
 */
import { type FixtureHandler, ok, paginated } from './types';

// ─── Utilidades ──────────────────────────────────────────────────────────────

/** ISO com deslocamento em dias/horas a partir de uma base fixa (deterministico). */
const BASE = new Date('2026-09-04T13:20:00.000Z').getTime();
const iso = (daysAgo: number, hours = 0): string =>
  new Date(BASE - daysAgo * 86_400_000 - hours * 3_600_000).toISOString();
const dateOnly = (daysAgo: number): string => iso(daysAgo).slice(0, 10);

/** Escolhe um valor da lista de forma ciclica (evita depender de Math.random). */
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length]!;

const SUPPLIERS = [
  'Zhejiang Yiwu Huayuan Import & Export Trading Company Limited (Ningbo Branch)',
  'Shenzhen Brightstar Electronics Manufacturing Co., Ltd.',
  'Guangzhou Kids Fashion Textile Industrial Group',
  'Yangzhou Toys & Gifts International Corporation',
  'Dongguan Premium Ceramics and Homeware Co.',
  'Hangzhou Sunrise Socks Knitting Factory Limited',
  'Qingdao Oceanic Bags & Luggage Co., Ltd.',
  'Ho Chi Minh City Garment Export Joint Stock Company',
  'PT Batik Nusantara Indah Tbk',
  'Istanbul Textile Exporters Association Member #4471',
] as const;

const PRODUCTS = [
  'Meia infantil cano medio estampa dinossauro pacote c/ 3 pares tamanhos 23-26 / 27-30 / 31-34',
  'Caneca de ceramica 350ml com tampa de bambu e colher, embalagem individual em caixa kraft',
  'Pelucia urso 45cm com laco de cetim e etiqueta bordada, certificado INMETRO',
  'Mochila escolar 18L poliester 600D com compartimento para notebook 14"',
  'Kit 6 taças vidro soprado 280ml decoração folha de ouro',
  'Pantufa adulto antiderrapante formato gato tamanhos 34-43',
  'Luminaria de mesa LED touch 3 tons de branco USB-C',
  'Jogo americano PVC 45x30cm estampa geometrica pacote c/ 4',
  'Garrafa termica inox 500ml parede dupla com infusor',
  'Pijama infantil algodao manga longa estampa espaco 2 pecas',
] as const;

const PROCESS_CODES = [
  'IM-2026-0001',
  'IM-2026-0002',
  'IM-2026-0003',
  'IM-2026-0014',
  'IM-2026-0027',
  'IM-2026-0031',
  'IM-2026-0042',
  'IM-2026-0058',
] as const;

// ─── Pre-conferencia ─────────────────────────────────────────────────────────

interface PreConsItem {
  id: number;
  processCode: string | null;
  orderDescription: string | null;
  etd: string | null;
  collection: string | null;
  portOfLoading: string | null;
  supplier: string | null;
  productName: string | null;
  itemCode: string | null;
  quantity: number | null;
  agreedPrice: string | null;
  ncmCode: string | null;
  amount: string | null;
  cbm: string | null;
  cargoReadyDate: string | null;
  eta: string | null;
  piNumber: string | null;
  sheetName: string | null;
  syncedAt: string;
}

const SHEETS = ['PUKET 2026-2', 'IMAGINARIUM VERAO 27', 'DIA DAS MAES 2027', 'NATAL 2026'] as const;
const PORTS = [
  'Ningbo',
  'Shenzhen (Yantian)',
  'Shanghai',
  'Ho Chi Minh (Cat Lai)',
  'Jakarta',
] as const;

const preConsItems: PreConsItem[] = Array.from({ length: 28 }, (_, i) => {
  const qty = pick([1200, 4800, 36_000, 150, 96_500, 24, 7200], i);
  const price = pick([0.42, 1.85, 12.9, 0.07, 3.15, 48.5], i);
  const isSparse = i % 9 === 8; // linha com muitos nulos
  return {
    id: 5001 + i,
    processCode: isSparse ? null : pick(PROCESS_CODES, i),
    orderDescription: isSparse
      ? null
      : `Pedido ${i + 1} - ${pick(['Reposicao de linha basica', 'Lancamento colecao', 'Compra oportunidade feira de Canton, negociado com desconto escalonado por volume'], i)}`,
    etd: isSparse ? null : dateOnly(-(i * 3) + 20),
    collection: pick(['Verao 2027', 'Inverno 2026', 'Volta as Aulas', null], i),
    portOfLoading: isSparse ? null : pick(PORTS, i),
    supplier: pick(SUPPLIERS, i),
    productName: pick(PRODUCTS, i),
    itemCode: isSparse
      ? null
      : `SKU-${String(100_000 + i * 37).padStart(6, '0')}-${pick(['P', 'M', 'G', 'UN'], i)}`,
    quantity: isSparse ? null : qty,
    agreedPrice: isSparse ? null : price.toFixed(4),
    ncmCode: pick(['6115.95.00', '6912.00.00', '9503.00.21', '4202.92.00', '7013.28.00', null], i),
    amount: isSparse ? null : (qty * price).toFixed(2),
    cbm: isSparse ? null : pick(['0.842', '12.350', '128.900', '0.015', '45.000'], i),
    cargoReadyDate: isSparse ? null : dateOnly(-(i * 3) + 28),
    eta: isSparse ? null : dateOnly(-(i * 3) - 25),
    piNumber: pick(['PI-YWH-2026-00417', 'PI/SZ/0912-A', null, 'PROFORMA 88123-REV3'], i),
    sheetName: pick(SHEETS, i),
    syncedAt: iso(1, i),
  };
});

const preConsSuppliers = [
  ...new Set(preConsItems.map((p) => p.supplier).filter(Boolean)),
] as string[];

function filterSortPreCons(url: URL): PreConsItem[] {
  const p = url.searchParams;
  const search = (p.get('search') ?? '').toLowerCase();
  const sheet = p.get('sheetName');
  const supplier = p.get('supplier');
  const sortBy = p.get('sortBy') ?? 'processCode';
  const order = p.get('sortOrder') === 'desc' ? -1 : 1;

  const filtered = preConsItems.filter((it) => {
    if (sheet && it.sheetName !== sheet) return false;
    if (supplier && it.supplier !== supplier) return false;
    if (!search) return true;
    return [it.processCode, it.productName, it.itemCode, it.supplier, it.piNumber]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(search));
  });

  return [...filtered].sort((a, b) => {
    const av = a[sortBy as keyof PreConsItem];
    const bv = b[sortBy as keyof PreConsItem];
    if (av == null) return 1;
    if (bv == null) return -1;
    const an = Number(av);
    const bn = Number(bv);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * order;
    return String(av).localeCompare(String(bv)) * order;
  });
}

const preConsSummary = (url: URL) => {
  const items = filterSortPreCons(url);
  return ok({
    totalFob: items.reduce((s, it) => s + Number(it.amount ?? 0), 0),
    totalCbm: items.reduce((s, it) => s + Number(it.cbm ?? 0), 0),
    totalQuantity: items.reduce((s, it) => s + (it.quantity ?? 0), 0),
    uniqueProcesses: new Set(items.map((it) => it.processCode).filter(Boolean)).size,
  });
};

const preConsDivergences = ok([
  {
    processCode: 'IM-2026-0001',
    field: 'totalFobValue',
    preConsValue: 'USD 184,320.00',
    systemValue: 'USD 181,904.50',
    severity: 'critical' as const,
  },
  {
    processCode: 'IM-2026-0014',
    field: 'etd',
    preConsValue: '2026-09-28',
    systemValue: '2026-10-12',
    severity: 'warning' as const,
  },
  {
    processCode: 'IM-2026-0027',
    field: 'totalCbm',
    preConsValue: '128.900',
    systemValue: '127.450',
    severity: 'info' as const,
  },
  {
    processCode: 'IM-2026-0058',
    field: 'containerType',
    preConsValue: "40' HC x 2 + 20' DRY x 1 (consolidado com pedido da Imaginarium)",
    systemValue: "40' HC x 3",
    severity: 'warning' as const,
  },
]);

const preConsSyncLogs = ok([
  {
    id: 91,
    source: 'upload',
    fileName: 'PRE-CONS_CONSOLIDADO_PUKET_IMAGINARIUM_2026-2_rev14_FINAL_FINAL_v2.xlsx',
    sheetsProcessed: 4,
    totalRows: 1284,
    created: 312,
    updated: 941,
    errors: 31,
    details: { skippedSheets: ['Resumo', 'Graficos'], warnings: 31 },
    syncedAt: iso(0, 2),
  },
  {
    id: 90,
    source: 'email',
    fileName: 'precons.xlsx',
    sheetsProcessed: 1,
    totalRows: 0,
    created: 0,
    updated: 0,
    errors: 1,
    details: { error: 'Planilha sem cabecalho reconhecido' },
    syncedAt: iso(1, 5),
  },
  {
    id: 89,
    source: 'upload',
    fileName: 'Pre-Cons Natal 2026.xlsx',
    sheetsProcessed: 2,
    totalRows: 96,
    created: 96,
    updated: 0,
    errors: 0,
    details: null,
    syncedAt: iso(3),
  },
  {
    id: 88,
    source: 'email',
    fileName: 'PRE CONS - DIA DAS MAES 2027 (enviado pelo comercial) .xlsx',
    sheetsProcessed: 1,
    totalRows: 220,
    created: 4,
    updated: 216,
    errors: 0,
    details: null,
    syncedAt: iso(7),
  },
]);

// ─── SYDLE (relatorio de pagamentos) ─────────────────────────────────────────

type PaymentStatus = 'open' | 'scheduled' | 'paid' | 'overdue' | 'cancelled' | 'unknown';
type PaymentType =
  | 'deposit'
  | 'deposit_in_advance'
  | 'balance'
  | 'balance_before_shipment'
  | 'balance_after_shipment'
  | 'fee'
  | 'refund'
  | 'other';
type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface SydlePayment {
  id: number;
  externalId: string;
  processId: number | null;
  matchStatus: MatchStatus;
  matchScore: string | null;
  matchReason: string | null;
  sydleProtocol: string | null;
  processCode: string | null;
  purchaseRef: string | null;
  purchaseOrder: string | null;
  proformaNumber: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  brand: string | null;
  currency: string;
  purchaseAmount: string | null;
  paidAmount: string | null;
  openAmount: string | null;
  paymentType: PaymentType;
  paymentStatus: PaymentStatus;
  dueDate: string | null;
  invoiceIssuedDate: string | null;
  taskCreatedAt: string | null;
  shipmentDate: string | null;
  paymentDeadlineAfterShipment: number | null;
  exceptionStatus: string | null;
  exceptionReason: string | null;
  paidAt: string | null;
  scheduledAt: string | null;
  exchangeRate: string | null;
  amountBrl: string | null;
  exchangeRateSource: 'sydle' | null;
  amountBrlSource: 'sydle' | null;
  bankName: string | null;
  contractNumber: string | null;
  remittanceId: string | null;
  sourceUpdatedAt: string | null;
  syncedAt: string;
  portalProcessCode: string | null;
  portalBrand: string | null;
  logisticStatus: string | null;
  processStatus: string | null;
}

const PAYMENT_STATUSES: PaymentStatus[] = [
  'open',
  'scheduled',
  'paid',
  'overdue',
  'cancelled',
  'unknown',
];
const PAYMENT_TYPES: PaymentType[] = [
  'deposit',
  'deposit_in_advance',
  'balance',
  'balance_before_shipment',
  'balance_after_shipment',
  'fee',
  'refund',
  'other',
];
const MATCH_STATUSES: MatchStatus[] = ['matched', 'ambiguous', 'unmatched'];
const MATCH_REASONS = [
  'process_code',
  'ambiguous:process_code_multiple_matches,supplier,amount',
  'no_confident_match',
  'purchase_ref,supplier',
  'invoice,supplier,amount,brand',
  'proforma',
] as const;
const LOGISTIC = [
  'consolidation',
  'waiting_shipment',
  'in_transit',
  'berthing',
  'registered',
  'customs_inspection',
  'port_release',
  'waiting_loading',
  'traveling_cd',
  'waiting_entry',
  'internalized',
  null,
] as const;
const CURRENCIES = ['USD', 'USD', 'USD', 'EUR', 'CNY', 'BRL'] as const;

const sydlePayments: SydlePayment[] = Array.from({ length: 30 }, (_, i) => {
  const status = pick(PAYMENT_STATUSES, i);
  const match = pick(MATCH_STATUSES, Math.floor(i / 2));
  const currency = pick(CURRENCIES, i);
  const purchase = pick([12_500, 184_320.55, 1_250_000, 96.4, 48_900, 730_150.99], i);
  const paid =
    status === 'paid' ? purchase : status === 'scheduled' ? 0 : purchase * pick([0, 0.3, 0.5], i);
  const rate = currency === 'BRL' ? null : pick(['5.4321', '5.8907', '0.7612', null], i);
  const hasBank = i % 4 !== 3;
  const unlinked = match === 'unmatched';
  return {
    id: 3001 + i,
    externalId: `sydle-pay-${String(70_000 + i * 13)}`,
    processId: unlinked ? null : 100 + (i % 8),
    matchStatus: match,
    matchScore: match === 'matched' ? '0.9650' : match === 'ambiguous' ? '0.5125' : null,
    matchReason: pick(MATCH_REASONS, i),
    sydleProtocol: i % 7 === 6 ? null : String(5300 + i),
    processCode: unlinked ? (i % 2 ? null : pick(PROCESS_CODES, i)) : pick(PROCESS_CODES, i),
    purchaseRef: pick(['PO-2026-00912', null, 'REF-CONSOLIDADA-PUKET-IMAGINARIUM-0044'], i),
    purchaseOrder: pick(['PO-2026-00912', 'PO-2026-01177-B', null], i),
    proformaNumber: pick(['PI-YWH-2026-00417', null, 'PROFORMA 88123-REV3'], i),
    invoiceNumber: pick(['INV-2026-08-0042', 'HYIE20260901-0007-A', null], i),
    supplierName: i % 11 === 10 ? null : pick(SUPPLIERS, i),
    brand: pick(['puket', 'imaginarium', null], i),
    currency,
    purchaseAmount: purchase.toFixed(2),
    paidAmount: status === 'unknown' ? null : paid.toFixed(2),
    openAmount: status === 'unknown' ? null : (purchase - paid).toFixed(2),
    paymentType: pick(PAYMENT_TYPES, i),
    paymentStatus: status,
    dueDate: status === 'unknown' ? null : dateOnly(status === 'overdue' ? 12 + i : -(i * 2) + 3),
    invoiceIssuedDate: pick([dateOnly(40 + i), null], i),
    taskCreatedAt: iso(35 + i, 3),
    shipmentDate: pick([dateOnly(20 + i), null], i),
    paymentDeadlineAfterShipment: pick([30, 60, 90, null, 0], i),
    exceptionStatus: pick([null, null, 'Em analise', 'Aprovada'], i),
    exceptionReason: pick(
      [
        null,
        null,
        'Fornecedor solicitou antecipacao do saldo por conta da alta do frete; aprovado pela diretoria financeira em reuniao de 02/09.',
        'Divergencia entre PI e Invoice',
      ],
      i,
    ),
    paidAt: status === 'paid' ? dateOnly(i) : null,
    scheduledAt: status === 'scheduled' ? dateOnly(-(i + 2)) : null,
    exchangeRate: rate,
    amountBrl: rate
      ? (purchase * Number(rate)).toFixed(2)
      : currency === 'BRL'
        ? purchase.toFixed(2)
        : null,
    exchangeRateSource: rate ? 'sydle' : null,
    amountBrlSource: rate || currency === 'BRL' ? 'sydle' : null,
    bankName: hasBank
      ? pick(
          ['Banco do Brasil S.A.', 'Itau Unibanco - Mesa de Cambio Internacional', 'Santander'],
          i,
        )
      : null,
    contractNumber: hasBank ? `CC-${2026}${String(10_000 + i)}` : null,
    remittanceId: hasBank && status === 'paid' ? `REM-${String(900_000 + i * 7)}` : null,
    sourceUpdatedAt: iso(i, 4),
    syncedAt: iso(0, 1),
    portalProcessCode: unlinked ? null : pick(PROCESS_CODES, i),
    portalBrand: unlinked ? null : pick(['puket', 'imaginarium'], i),
    logisticStatus: unlinked ? null : pick(LOGISTIC, i),
    processStatus: unlinked ? null : pick(['active', 'completed', 'cancelled'], i),
  };
});

function filterSydle(url: URL): SydlePayment[] {
  const p = url.searchParams;
  const search = (p.get('search') ?? '').toLowerCase();
  const supplier = (p.get('supplier') ?? '').toLowerCase();
  const brand = p.get('brand');
  const currency = p.get('currency');
  const logisticStatus = p.get('logisticStatus');
  const paymentStatus = p.get('paymentStatus');
  const paymentType = p.get('paymentType');
  const matchStatus = p.get('matchStatus');
  return sydlePayments.filter((r) => {
    if (brand && r.brand !== brand && r.portalBrand !== brand) return false;
    if (currency && r.currency !== currency) return false;
    if (logisticStatus && r.logisticStatus !== logisticStatus) return false;
    if (paymentStatus && r.paymentStatus !== paymentStatus) return false;
    if (paymentType && r.paymentType !== paymentType) return false;
    if (matchStatus && r.matchStatus !== matchStatus) return false;
    if (supplier && !(r.supplierName ?? '').toLowerCase().includes(supplier)) return false;
    if (!search) return true;
    return [
      r.sydleProtocol,
      r.processCode,
      r.portalProcessCode,
      r.invoiceNumber,
      r.proformaNumber,
      r.purchaseOrder,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(search));
  });
}

const sydleSyncRuns = [
  {
    id: 412,
    status: 'success',
    trigger: 'cron',
    startedAt: iso(0, 1),
    completedAt: iso(0, 0.95),
    duration: 184,
    fetched: 1980,
    created: 12,
    updated: 1968,
    matched: 1611,
    unmatched: 369,
    errors: 0,
    errorMessage: null,
    metadata: { pages: 40, pageSize: 50 },
  },
  {
    id: 411,
    status: 'partial',
    trigger: 'manual',
    startedAt: iso(1, 2),
    completedAt: iso(1, 1.9),
    duration: 421,
    fetched: 1500,
    created: 0,
    updated: 1490,
    matched: 1200,
    unmatched: 290,
    errors: 10,
    errorMessage:
      'Pagina 31: timeout apos 30s (3 tentativas). Registros 1501-1980 nao sincronizados.',
    metadata: { failedPages: [31, 32, 33] },
  },
  {
    id: 410,
    status: 'failed',
    trigger: 'cron',
    startedAt: iso(2, 3),
    completedAt: iso(2, 2.99),
    duration: 3,
    fetched: 0,
    created: 0,
    updated: 0,
    matched: 0,
    unmatched: 0,
    errors: 1,
    errorMessage:
      'HTTP 401 Unauthorized: a API key do SYDLE foi rejeitada. Verifique SYDLE_API_KEY no ambiente do container da API.',
    metadata: null,
  },
  {
    id: 409,
    status: 'skipped',
    trigger: 'cron',
    startedAt: iso(3, 3),
    completedAt: iso(3, 3),
    duration: 0,
    fetched: null,
    created: null,
    updated: null,
    matched: null,
    unmatched: null,
    errors: null,
    errorMessage: null,
    metadata: { reason: 'integration_disabled' },
  },
  {
    id: 408,
    status: 'running',
    trigger: 'manual',
    startedAt: iso(0, 0.1),
    completedAt: null,
    duration: null,
    fetched: 250,
    created: null,
    updated: null,
    matched: null,
    unmatched: null,
    errors: null,
    errorMessage: null,
    metadata: null,
  },
];

const sydleSummary = (url: URL) => {
  const rows = filterSydle(url);
  const sum = (sel: (r: SydlePayment) => string | null, filter?: (r: SydlePayment) => boolean) =>
    rows.filter(filter ?? (() => true)).reduce((s, r) => s + Number(sel(r) ?? 0), 0);
  const byCurrency = new Map<
    string,
    { totalPurchase: number; totalPaid: number; totalOpen: number; records: number }
  >();
  for (const r of rows) {
    const acc = byCurrency.get(r.currency) ?? {
      totalPurchase: 0,
      totalPaid: 0,
      totalOpen: 0,
      records: 0,
    };
    acc.totalPurchase += Number(r.purchaseAmount ?? 0);
    acc.totalPaid += Number(r.paidAmount ?? 0);
    acc.totalOpen += Number(r.openAmount ?? 0);
    acc.records += 1;
    byCurrency.set(r.currency, acc);
  }
  const usd = (r: SydlePayment) => r.currency === 'USD';
  return ok({
    totalPurchaseUsd: sum((r) => r.purchaseAmount, usd),
    totalPaidUsd: sum((r) => r.paidAmount, usd),
    totalOpenUsd: sum((r) => r.openAmount, usd),
    totalBrl: sum((r) => r.amountBrl),
    currencyBreakdown: [...byCurrency.entries()].map(([currency, v]) => ({ currency, ...v })),
    records: rows.length,
    matched: rows.filter((r) => r.matchStatus === 'matched').length,
    unmatched: rows.filter((r) => r.matchStatus !== 'matched').length,
    overdue: rows.filter((r) => r.paymentStatus === 'overdue').length,
    dueSoon: rows.filter((r) => r.paymentStatus === 'open').length,
    paid: rows.filter((r) => r.paymentStatus === 'paid').length,
    config: {
      enabled: true,
      configured: true,
      missing: [],
      paymentsPath: '/api/1/importacao/pagamentos-internacionais/relatorio',
      pageSize: 50,
    },
    lastRun: sydleSyncRuns[0]!,
  });
};

const sydleDetail = (url: URL) => {
  const id = Number(url.pathname.split('/').pop());
  const base = sydlePayments.find((r) => r.id === id) ?? sydlePayments[0]!;
  return ok({
    ...base,
    sourceSystem: 'SYDLE ONE',
    rawPayload: {
      _id: base.externalId,
      protocolo: base.sydleProtocol,
      beneficiario: { nome: base.supplierName, pais: 'CN', swift: 'BKCHCNBJ' },
      valores: { moeda: base.currency, compra: base.purchaseAmount, pago: base.paidAmount },
      observacoes:
        'Campo livre preenchido pelo financeiro com texto longo e sem quebra de linha para verificar se o bloco JSON do drawer rola horizontalmente em vez de estourar a largura do painel.',
      historico: [
        { em: iso(20), acao: 'criado' },
        { em: iso(5), acao: 'agendado' },
        { em: iso(1), acao: 'pago' },
      ],
    },
    createdAt: iso(40),
    updatedAt: iso(0, 2),
    processExporter: base.supplierName,
  });
};

// ─── Atendimentos (communications) ───────────────────────────────────────────

type CommStatus = 'draft' | 'sent' | 'failed';

const COMM_SUBJECTS = [
  'IM-2026-0001 | Documentos para desembaraco - Invoice, Packing List e BL (2a via corrigida)',
  'Re: Re: Fwd: URGENTE - Pendencia de LI para processo IM-2026-0014 com ETA em 3 dias uteis',
  'Envio do espelho DUIMP',
  'Solicitacao de retificacao de NCM nos itens 12 a 47 da invoice HYIE20260901-0007-A conforme parecer da consultoria',
  'Confirmacao de agendamento de carregamento CD Extrema',
] as const;

const COMM_BODY_LONG = `Bruna, boa tarde.

Seguem em anexo os documentos do processo para conferencia e registro:

1. Fatura comercial (invoice) HYIE20260901-0007-A, revisada pelo fornecedor apos a divergencia de NCM apontada na pre-conferencia;
2. Packing list consolidado, com 3 containers 40' HC e pesos brutos/liquidos por volume;
3. Conhecimento de embarque (OHBL) MSCUNB8827731, emitido em 28/08 pela MSC.

Observacoes importantes:
- A invoice traz os valores em USD com o Incoterm FOB Ningbo; o frete internacional sera informado pelo agente de carga em documento separado.
- Os itens 12 a 47 tiveram o NCM alterado de 6115.96.00 para 6115.95.00 conforme parecer da consultoria, o que impacta a aliquota de II e precisa refletir na DUIMP.
- Pedimos atencao ao prazo: o navio tem ETA em Santos para o dia 09/09 e o free time e de 7 dias.

Fico a disposicao para qualquer duvida.

Atenciosamente,`;

const communications = Array.from({ length: 24 }, (_, i) => {
  const status = pick<CommStatus>(['sent', 'draft', 'failed', 'sent', 'sent'], i);
  return {
    id: 8001 + i,
    processId: 100 + (i % 8),
    recipient: pick(
      [
        'Bruna Carvalho (Fenicia Comex)',
        'ISA Despachos Aduaneiros - Setor de Registro',
        'Comercial',
      ],
      i,
    ),
    recipientEmail: pick(
      [
        'bruna.carvalho@feniciacomex.com.br',
        'registro.aduaneiro.santos@isadespachosaduaneiros.com.br',
        'comercial@grupounico.com',
      ],
      i,
    ),
    subject: pick(COMM_SUBJECTS, i),
    body:
      i % 3 === 0
        ? COMM_BODY_LONG
        : `Segue o documento solicitado referente ao processo ${pick(PROCESS_CODES, i)}.`,
    attachments:
      i % 4 === 3
        ? null
        : [
            {
              filename: 'INVOICE_HYIE20260901-0007-A_REV2_assinada_carimbada_scan_300dpi.pdf',
              documentId: 7001 + i,
            },
            { filename: 'Packing List.pdf', documentId: 7101 + i },
            { espelhoId: 55 + i },
            { documentId: 7201 + i },
          ].slice(0, (i % 4) + 1),
    status,
    createdAt: iso(i, 2),
    sentAt: status === 'sent' ? iso(i, 1) : null,
  };
});

function filterCommunications(url: URL) {
  const start = url.searchParams.get('startDate');
  const end = url.searchParams.get('endDate');
  return communications.filter((c) => {
    const day = c.createdAt.slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

const driveFiles = ok([
  {
    id: '1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT',
    name: 'IM-2026-0001 - INVOICE + PACKING LIST + BL - fornecedor Zhejiang Yiwu Huayuan (versao final assinada).pdf',
    mimeType: 'application/pdf',
    size: 18_432_910,
    webViewLink: 'https://drive.google.com/file/d/1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT/view',
  },
  {
    id: '2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU',
    name: 'Espelho DUIMP.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 24_117_248,
    webViewLink: 'https://drive.google.com/file/d/2bC3dE4fG5hI6jK7lM8nO9pQ0rS1tU/view',
  },
  {
    id: '3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV',
    name: 'foto_container_lacre.jpg',
    mimeType: 'image/jpeg',
    size: null,
    webViewLink: null,
  },
  {
    id: '4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW',
    name: 'LI 26/1234567-8 deferida.pdf',
    mimeType: 'application/pdf',
    size: 210_003,
    webViewLink: 'https://drive.google.com/file/d/4dE5fG6hI7jK8lM9nO0pQ1rS2tU3vW/view',
  },
]);

const emailSignatures = ok([
  {
    id: 1,
    name: 'Padrao - Importacao Grupo Uni.co',
    signatureHtml:
      '<p><strong>Equipe de Importacao</strong><br/>Grupo Uni.co | Puket &amp; Imaginarium<br/>Rod. Fernao Dias, km 900 - Extrema/MG<br/><a href="https://www.grupounico.com">www.grupounico.com</a></p><p style="font-size:10px;color:#888">Esta mensagem pode conter informacoes confidenciais. Se voce a recebeu por engano, avise o remetente e apague-a.</p>',
    isDefault: true,
  },
  {
    id: 2,
    name: 'Assinatura curta para respostas rapidas (sem disclaimer juridico)',
    signatureHtml: '<p>Att.,<br/>Importacao Uni.co</p>',
    isDefault: false,
  },
  {
    id: 3,
    name: 'Financeiro internacional',
    signatureHtml:
      '<table><tr><td><strong>Financeiro Internacional</strong></td></tr><tr><td>Grupo Uni.co</td></tr><tr><td>pagamentos.internacionais@grupounico.com</td></tr></table>',
    isDefault: false,
  },
]);

const communicationTemplates = (url: URL) => {
  const all = [
    {
      id: 1,
      name: 'Envio de documentos para desembaraco (Fenicia)',
      recipient: 'Bruna Carvalho (Fenicia Comex)',
      recipientEmail: 'bruna.carvalho@feniciacomex.com.br',
      subject: '{{processCode}} | Documentos para desembaraco',
      body: 'Bruna, boa tarde.\n\nSeguem em anexo os documentos do processo {{processCode}} para conferencia e registro.\n\nAtenciosamente,',
      isActive: true,
    },
    {
      id: 2,
      name: 'Solicitacao de espelho DUIMP para conferencia interna antes do registro definitivo na Receita Federal',
      recipient: 'ISA Despachos Aduaneiros - Setor de Registro',
      recipientEmail: 'registro.aduaneiro.santos@isadespachosaduaneiros.com.br',
      subject: 'Espelho DUIMP - {{processCode}} - favor enviar antes do registro',
      body: COMM_BODY_LONG,
      isActive: true,
    },
    {
      id: 3,
      name: 'Modelo antigo (desativado)',
      recipient: null,
      recipientEmail: null,
      subject: 'Sem assunto definido',
      body: '',
      isActive: false,
    },
    {
      id: 4,
      name: 'Cobranca de LI pendente',
      recipient: 'Comercial',
      recipientEmail: 'comercial@grupounico.com',
      subject: 'LI pendente - {{processCode}}',
      body: 'Pessoal, a LI do processo {{processCode}} ainda nao foi deferida. Precisamos do retorno ate {{deadline}}.',
      isActive: true,
    },
  ];
  const activeOnly = url.searchParams.get('active') !== 'false';
  return ok(activeOnly ? all.filter((t) => t.isActive) : all);
};

/** Documentos de um processo (composer de atendimento e DocumentList). */
const processDocuments = (url: URL) => {
  const processId = Number(url.pathname.split('/').pop()) || 100;
  const types = [
    'invoice',
    'packing_list',
    'ohbl',
    'draft_bl',
    'draft_duimp',
    'duimp',
    'espelho',
    'li',
    'certificate',
    'proforma_invoice',
    'other',
  ];
  return ok(
    types.map((documentType, i) => ({
      id: 7001 + processId + i,
      fileName:
        i === 0
          ? 'INVOICE_HYIE20260901-0007-A_REV2_assinada_carimbada_scan_300dpi_fornecedor_Zhejiang_Yiwu.pdf'
          : `${documentType.toUpperCase()}_${pick(PROCESS_CODES, processId)}.pdf`,
      documentType,
      uploadedAt: iso(i, 3),
      aiProcessingStatus: pick(['completed', 'processing', 'failed', 'pending'] as const, i),
      aiConfidence: pick([0.97, 0.62, null, 0.41], i),
      driveFileId: i % 3 === 0 ? `drive-${processId}-${i}` : null,
    })),
  );
};

// ─── Ingestao de e-mail ──────────────────────────────────────────────────────

type EmailLogStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'ignored' | 'reprocessed';

const EMAIL_SUBJECTS = [
  'FW: RE: RE: [EXTERNAL] Shipping documents for PO-2026-00912 / INV HYIE20260901-0007-A / BL MSCUNB8827731 - Ningbo to Santos - ETD 28 AUG',
  'Documentos IM-2026-0014',
  'DRAFT BL for your approval - please confirm within 24 hours otherwise it will be released as is',
  '(sem assunto)',
  'Espelho DUIMP - IM-2026-0027 - retificacao 3',
  'Newsletter: as 10 tendencias do comercio exterior em 2027',
] as const;

const EMAIL_SENDERS = [
  'bruna.carvalho@feniciacomex.com.br',
  '"Ningbo Ocean Shipping Agency Co., Ltd. - Documentation Dept." <documentation.ningbo.export.branch@oceanshippingagency-global-logistics.com.cn>',
  'registro.aduaneiro.santos@isadespachosaduaneiros.com.br',
  'noreply@mailchimp-newsletters.example',
  'sales@szbrightstar.cn',
] as const;

const emailLogs = Array.from({ length: 26 }, (_, i) => {
  const status = pick<EmailLogStatus>(
    ['completed', 'failed', 'pending', 'processing', 'ignored', 'reprocessed', 'completed'],
    i,
  );
  const attachmentsCount = pick([1, 3, 0, 7, 2], i);
  const processed =
    status === 'completed' || status === 'reprocessed'
      ? attachmentsCount
      : status === 'failed'
        ? Math.max(0, attachmentsCount - 1)
        : 0;
  const linked = status !== 'ignored' && status !== 'failed';
  return {
    id: 9001 + i,
    messageId: `<CAE+${String(1_000_000 + i * 991)}.${i}@mail.gmail.com>`,
    fromAddress: pick(EMAIL_SENDERS, i),
    subject: pick(EMAIL_SUBJECTS, i),
    receivedAt: iso(i, 5),
    processId: linked ? String(100 + (i % 8)) : null,
    status,
    attachmentsCount,
    processedAttachments: processed,
    processedAttachmentDetails:
      processed > 0
        ? Array.from({ length: processed }, (_, k) => ({
            filename: pick(
              [
                'INVOICE_HYIE20260901-0007-A_REV2_assinada_carimbada_scan_300dpi.pdf',
                'PL.pdf',
                'BL MSCUNB8827731 - TELEX RELEASE.pdf',
                'image001.png',
              ],
              k,
            ),
            type: pick(['invoice', 'packing_list', 'ohbl', 'other'], k),
            documentId: k === 3 ? null : String(7001 + i + k),
          }))
        : undefined,
    errorMessage:
      status === 'failed'
        ? pick(
            [
              'Anexo "Packing List.pdf" excede o limite de 20 MB (recebido: 47,3 MB). O e-mail foi marcado como falha; anexos menores foram processados normalmente.',
              'Remetente nao esta na lista de permitidos',
              'Falha na extracao por IA: resposta do modelo nao respeitou o contrato JSON (prompt com 11.204 tokens). Reprocesse com o documento isolado.',
            ],
            i,
          )
        : null,
    processCode: linked ? pick(PROCESS_CODES, i) : null,
    createdAt: iso(i, 4.9),
  };
});

function filterEmailLogs(url: URL) {
  const start = url.searchParams.get('startDate');
  const end = url.searchParams.get('endDate');
  return emailLogs.filter((l) => {
    const day = l.receivedAt.slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  });
}

const emailStatus = ok({
  enabled: true,
  method: 'gmail_api' as const,
  gmailConfigured: true,
  imapConfigured: false,
  sharedMailbox: 'importacao.documentos.recebidos@grupounico.com',
  allowedSenders:
    'bruna.carvalho@feniciacomex.com.br, registro.aduaneiro.santos@isadespachosaduaneiros.com.br, *@oceanshippingagency-global-logistics.com.cn, *@szbrightstar.cn, comercial@grupounico.com, financeiro@grupounico.com, sales@yiwuhuayuan.com, docs@mscglobal.example',
  lastRun: iso(0, 0.25),
  todayStats: [
    { status: 'completed', count: 42 },
    { status: 'failed', count: 3 },
    { status: 'pending', count: 5 },
    { status: 'processing', count: 1 },
    { status: 'ignored', count: 118 },
    { status: 'reprocessed', count: 2 },
  ],
});

// ─── Auditoria ───────────────────────────────────────────────────────────────

const users = [
  {
    id: 1,
    name: 'Nicolas Matsuda',
    email: 'nicolas.matsuda@grupounico.com',
    role: 'admin',
    isActive: true,
  },
  {
    id: 2,
    name: 'Maria Eduarda Albuquerque de Oliveira Figueiredo dos Santos',
    email: 'maria.eduarda.albuquerque.figueiredo@importacao.grupounico.com.br',
    role: 'analyst',
    isActive: true,
  },
  { id: 3, name: 'Odett', email: 'odett@grupounico.com', role: 'analyst', isActive: true },
  {
    id: 4,
    name: 'Joao Pedro (estagiario)',
    email: 'joao.pedro.estagio@grupounico.com',
    role: 'viewer',
    isActive: false,
  },
  {
    id: 5,
    name: 'Integracao SYDLE (conta de servico)',
    email: 'svc-sydle-sync@grupounico.com',
    role: 'service',
    isActive: true,
  },
  {
    id: 6,
    name: 'Ana Beatriz Lima',
    email: 'ana.lima@grupounico.com',
    role: 'admin',
    isActive: false,
  },
  { id: 7, name: 'Carlos H.', email: 'c@u.co', role: 'analyst', isActive: true },
  {
    id: 8,
    name: 'Fernanda Rocha Guimaraes',
    email: 'fernanda.guimaraes@grupounico.com',
    role: 'analyst',
    isActive: true,
  },
];

const AUDIT_ACTIONS = [
  'login',
  'create',
  'update',
  'delete',
  'upload',
  'reprocess',
  'email_processed',
  'validation_run',
  'manual_resolution',
  'alert_created',
  'acknowledge',
  'generate',
  'sent_to_fenicia',
  'acao_desconhecida_sem_label',
] as const;
const AUDIT_ENTITIES = [
  'process',
  'document',
  'espelho',
  'alert',
  'user',
  'email',
  'validation',
  null,
  'setting',
] as const;

const auditLogs = Array.from({ length: 30 }, (_, i) => {
  const action = pick(AUDIT_ACTIONS, i);
  const user = i % 6 === 5 ? null : pick(users, i);
  return {
    id: 20_001 + i,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    action,
    entityType: pick(AUDIT_ENTITIES, i),
    entityId: i % 5 === 4 ? null : 100 + (i % 8),
    details:
      i % 4 === 3
        ? null
        : action === 'update'
          ? {
              changes: {
                etd: { from: '2026-09-28', to: '2026-10-12' },
                totalFobValue: { from: '181904.50', to: '184320.00' },
                incoterm: { from: 'FOB', to: 'CIF' },
                notes: {
                  from: null,
                  to: 'Alteracao solicitada pelo fornecedor por e-mail em 01/09; frete passou a ser pago na origem e o valor foi incorporado a invoice revisada.',
                },
              },
              reason: 'Retificacao apos pre-conferencia',
              source: 'ui',
              userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
            }
          : {
              processCode: pick(PROCESS_CODES, i),
              fileName: 'INVOICE_HYIE20260901-0007-A_REV2_assinada_carimbada_scan_300dpi.pdf',
              sizeBytes: 18_432_910,
              durationMs: 1840 + i * 97,
              nested: {
                level1: { level2: { level3: { ok: true, list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } } },
              },
            },
    ipAddress: pick(
      ['10.20.30.41', '2804:14d:5c82:8f00:1d2e:9a3f:7b6c:e5d4', null, '187.45.120.9'],
      i,
    ),
    createdAt: iso(i * 0.4, i),
  };
});

function filterAuditLogs(url: URL) {
  const p = url.searchParams;
  const action = p.get('action');
  const entityType = p.get('entityType');
  const userId = p.get('userId');
  return auditLogs.filter((l) => {
    if (action && l.action !== action) return false;
    if (entityType && l.entityType !== entityType) return false;
    if (userId && String(l.userId) !== userId) return false;
    return true;
  });
}

// ─── Configuracoes ───────────────────────────────────────────────────────────

const webhookSetting = ok({
  key: 'google_chat_webhook_url',
  value:
    'https://chat.googleapis.com/v1/spaces/AAAAxxxxxxx/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_',
});

const smtpSettings = ok([
  { key: 'smtp_host', value: 'smtp-relay.gmail.com' },
  { key: 'smtp_port', value: '587' },
  { key: 'smtp_user', value: 'importacao.notificacoes.automaticas@grupounico.com' },
  {
    key: 'smtp_from',
    value: 'Importacao Grupo Uni.co <importacao.notificacoes.automaticas@grupounico.com>',
  },
]);

const recipientSettings = ok([
  { key: 'kiom_email', value: 'kiom@kiomlogistica.com.br' },
  {
    key: 'fenicia_email',
    value:
      'bruna.carvalho@feniciacomex.com.br; operacional@feniciacomex.com.br; registro@feniciacomex.com.br; diretoria@feniciacomex.com.br',
  },
  { key: 'isa_email', value: 'registro.aduaneiro.santos@isadespachosaduaneiros.com.br' },
  { key: 'default_cc_email', value: '' },
]);

const integrationSettings = ok([
  {
    key: 'drive_client_email',
    value: 'importacao-drive-sa@grupounico-importacao-prod-1a2b3c.iam.gserviceaccount.com',
  },
  { key: 'drive_root_folder_id', value: '1XyZ_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789' },
  { key: 'odoo_url', value: 'https://erp.grupounico.com.br:8069' },
  { key: 'odoo_db', value: 'grupounico_producao_2026' },
  { key: 'odoo_user', value: 'integracao.importacao@grupounico.com' },
]);

// ─── Assistente ──────────────────────────────────────────────────────────────

const assistantAnswer = ok({
  question: 'Quais atendimentos pendentes precisam de ação?',
  answer: `Encontrei 4 evidências relevantes. Resumo do que precisa de ação agora:

1. IM-2026-0014 — a Licença de Importação ainda não foi deferida e o navio tem ETA em Santos em 3 dias úteis. O atendimento 8003 para a ISA está em rascunho há 2 dias e nunca foi enviado. Recomendo enviar hoje e acionar o comercial em cópia.

2. IM-2026-0001 — o envio dos documentos para a Fenícia falhou (SMTP recusou o anexo de 47 MB). O e-mail precisa ser reenviado com o packing list comprimido ou via link do Drive.

3. Alerta crítico aberto: divergência de USD 2.415,50 entre o valor FOB da pré-conferência e o da invoice revisada. Ninguém reconheceu o alerta ainda.

4. O último e-mail do agente de carga em Ningbo (draft BL para aprovação) foi processado como "ignorado" porque o remetente não está na lista de permitidos. Se o draft não for aprovado em 24h, o BL sai como está.

Observação: a resposta considera apenas dados internos do sistema; confirme prazos diretamente com o despachante antes de tomar decisões que envolvam custo de armazenagem ou demurrage.`,
  sources: [
    {
      id: 'communication:8003',
      type: 'communication' as const,
      title:
        'Re: Re: Fwd: URGENTE - Pendencia de LI para processo IM-2026-0014 com ETA em 3 dias uteis',
      subtitle: 'Rascunho · ISA Despachos Aduaneiros - Setor de Registro',
      excerpt:
        'Atendimento em rascunho desde 02/09 sem envio. Corpo menciona LI 26/1234567-8 pendente de deferimento e solicita registro antecipado da DUIMP para evitar armazenagem no porto.',
      url: '/importacao/processos/101?tab=comunicacoes',
      createdAt: iso(2),
      score: 0.93,
    },
    {
      id: 'alert:551',
      type: 'alert' as const,
      title: 'Divergência de valor FOB acima da tolerância',
      subtitle: 'Crítico · IM-2026-0001',
      excerpt:
        'Pre-Cons USD 184.320,00 vs invoice USD 181.904,50 (diferença 1,33%, tolerância 0,5%). Alerta não reconhecido.',
      url: '/importacao/alertas',
      createdAt: iso(1),
      score: 0.81,
    },
    {
      id: 'email_ingestion:9002',
      type: 'email_ingestion' as const,
      title:
        'DRAFT BL for your approval - please confirm within 24 hours otherwise it will be released as is',
      subtitle:
        'Ignorado · documentation.ningbo.export.branch@oceanshippingagency-global-logistics.com.cn',
      excerpt:
        'E-mail ignorado pela ingestão porque o domínio do remetente não consta na lista de permitidos. Contém 3 anexos (draft BL, VGM e SI confirmation) que não foram processados.',
      url: '/importacao/ingestao-email',
      createdAt: iso(0, 6),
      score: 0.74,
    },
    {
      id: 'knowledge:procedimento-li',
      type: 'knowledge' as const,
      title: 'Procedimento interno: registro de DUIMP com LI pendente',
      subtitle: 'Base de conhecimento · atualizado em 12/06/2026',
      excerpt:
        'Quando a LI não estiver deferida até 2 dias úteis antes do ETA, o analista deve solicitar ao despachante o registro antecipado e comunicar o comercial para renegociar free time com o armador.',
      createdAt: null,
      score: 0.58,
    },
  ],
  confidence: 0.82,
  mode: 'ai' as const,
  generatedAt: iso(0),
});

// ─── Handlers ────────────────────────────────────────────────────────────────

export const importacaoOpsHandlers: FixtureHandler[] = [
  // Pre-conferencia
  { path: '/api/pre-cons/summary', body: preConsSummary },
  { path: '/api/pre-cons/items', body: (url: URL) => paginated(filterSortPreCons(url), url, 50) },
  { path: '/api/pre-cons/divergences', body: preConsDivergences },
  { path: '/api/pre-cons/sheets', body: ok([...SHEETS]) },
  { path: '/api/pre-cons/suppliers', body: ok(preConsSuppliers) },
  { path: '/api/pre-cons/sync-logs', body: preConsSyncLogs },
  {
    path: '/api/pre-cons/sync',
    method: 'POST',
    body: ok({ created: 312, updated: 941, errors: 0, divergences: preConsDivergences.data }),
  },

  // SYDLE (o summary vem antes do regex de detalhe para nao ser capturado por ele)
  { path: '/api/sydle/payments-report/summary', body: sydleSummary },
  { path: '/api/sydle/payments-report', body: (url: URL) => paginated(filterSydle(url), url, 50) },
  { path: /^\/api\/sydle\/payments-report\/\d+$/, body: sydleDetail },
  {
    path: '/api/sydle/sync-runs',
    body: (url: URL) =>
      ok(sydleSyncRuns.slice(0, Number(url.searchParams.get('limit') ?? sydleSyncRuns.length))),
  },
  { path: '/api/sydle/sync-now', method: 'POST', body: ok(sydleSyncRuns[0]) },

  // Atendimentos
  {
    path: '/api/communications',
    body: (url: URL) => paginated(filterCommunications(url), url, 50),
  },
  { path: '/api/communications/drive/files', body: driveFiles },
  { path: '/api/settings/communication-templates', body: communicationTemplates },
  { path: '/api/settings/email-signatures', body: emailSignatures },
  { path: /^\/api\/documents\/process\/\d+$/, body: processDocuments },

  // Ingestao de e-mail
  { path: '/api/email-ingestion/status', body: emailStatus },
  {
    path: '/api/email-ingestion/logs',
    body: (url: URL) => paginated(filterEmailLogs(url), url, 20),
  },

  // Auditoria
  { path: '/api/audit/logs', body: (url: URL) => paginated(filterAuditLogs(url), url, 20) },
  { path: '/api/auth/users', body: ok(users) },

  // Configuracoes
  { path: '/api/settings/google_chat_webhook_url', body: webhookSetting },
  { path: '/api/settings/integrations', body: integrationSettings },
  { path: '/api/settings/recipients', body: recipientSettings },
  { path: '/api/settings/smtp', body: smtpSettings },

  // Assistente (pagina e bolha flutuante)
  { path: '/api/assistant/query', method: 'POST', body: assistantAnswer },
];
