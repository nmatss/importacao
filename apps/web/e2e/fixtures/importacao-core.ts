/**
 * Fixtures de API do modulo de importacao (nucleo) para a auditoria visual
 * responsiva. Dados 100% ficticios, dimensionados para ESTRESSAR o layout:
 * nomes longos, todos os status, listas com 20-60 linhas, valores grandes,
 * campos nulos e datas espalhadas em torno de "hoje".
 *
 * Shapes conferidos nos consumidores em 2026-09-06:
 * - processos: ProcessListPage, ProcessDetailPage, ProcessHeader,
 *   ProcessInfoCard, ProcessEditPage, LogisticStatusBar, ProcessTimeline,
 *   DesembaracoPage, NumerarioPage, CurrencyExchangePage (seletor);
 * - dashboard: DashboardPage, ExecutiveDashboardPage, SLADashboard,
 *   MeuDiaPage, PortalPage;
 * - alertas: AlertsPage, MeuDiaPage; e-mails: DashboardPage,
 *   EmailIngestionPage, ProcessDetailPage; follow-up: FollowUpPage;
 *   LI: LiTrackingPage; cambio: CurrencyExchangePage, ProcessDetailPage.
 */
import { type FixtureHandler, ok, paginated } from './types';

// ── Datas relativas a "hoje" ─────────────────────────────────────────────
// As telas comparam com Date.now() (dias sem atualizacao, ETD no passado,
// vencimentos). Datas relativas mantem o cenario visual estavel ao longo do tempo.

const NOW = new Date();

/** ISO completo deslocado `days` dias de hoje (negativo = passado). */
function iso(days: number, hour = 10, minute = 30): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Somente a data (YYYY-MM-DD), como o backend grava colunas `date`. */
function day(days: number): string {
  return iso(days).slice(0, 10);
}

/** Rotulo YYYY-MM de `monthsAgo` meses atras. */
function monthLabel(monthsAgo: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Catalogos ────────────────────────────────────────────────────────────

export const AUDIT_USER = {
  id: '1',
  name: 'Nicolas Matsuda Auditoria',
  email: 'auditoria@e2e.test',
  role: 'admin',
};

const STATUSES = [
  'draft',
  'documents_received',
  'validating',
  'validated',
  'espelho_generated',
  'sent_to_fenicia',
  'li_pending',
  'completed',
  'cancelled',
] as const;

type ProcessStatus = (typeof STATUSES)[number];

const LOGISTIC_STAGES = [
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
] as const;

const EXPORTERS = [
  'Shenzhen Guangming Textile Import & Export Co., Ltd.',
  'Ningbo Haitian Household Products Manufacturing Company Limited',
  'Yiwu Sunshine Gifts & Crafts Trading Co., Ltd.',
  'Dongguan Everbright Socks Knitting Factory',
  'Guangzhou Meiling Ceramics and Glassware Industrial Group Co.',
  'Hangzhou Silk Road Apparel Co., Ltd.',
  'Bangkok Premium Home Decor Manufacturing Co., Ltd.',
  'PT Nusantara Rattan Furniture Export Indonesia',
];

const EXPORTER_ADDRESSES = [
  'Building 7, No. 1188 Guangming Avenue, Bao’an District, Shenzhen, Guangdong 518101, People’s Republic of China',
  'No. 66 Haitian Road, Beilun Industrial Zone, Ningbo, Zhejiang 315800, China',
  'Room 2305, Futian Trade Mansion, Yiwu International Trade City, Yiwu 322000, Zhejiang, China',
  'Xinlian Industrial Park, Humen Town, Dongguan 523900, Guangdong, China',
];

const PORTS_LOADING = [
  'Yantian, CN',
  'Ningbo, CN',
  'Shanghai, CN',
  'Laem Chabang, TH',
  'Surabaya, ID',
];
const PORTS_DISCHARGE = ['Santos, BR', 'Itapoa, BR', 'Paranagua, BR', 'Navegantes, BR'];
const VESSELS = [
  'MSC GULSUN',
  'EVER ACE',
  'CMA CGM JACQUES SAADE',
  'MAERSK EINDHOVEN',
  'HMM ALGECIRAS',
  'ONE INNOVATION',
];
const SHIPPING_LINES = ['MSC', 'Maersk', 'CMA CGM', 'Hapag-Lloyd', 'ONE', 'Evergreen'];
const FREIGHT_AGENTS = [
  'Fenicia Logistica Internacional Ltda.',
  'Craft Multimodal Agenciamento de Cargas',
  'Asia Shipping Transportes Internacionais',
];
const CONTAINERS = ['40HC', '20DC', '40DC', '2 x 40HC', '45HC', 'LCL'];
const CHANNELS = ['verde', 'amarelo', 'vermelho', null] as const;
const INSPECTIONS = ['Inmetro', 'MAPA', 'Anvisa', null] as const;

// ── Processos ────────────────────────────────────────────────────────────

type ProcessDocument = {
  id: number;
  type: string;
  originalFilename: string;
  isProcessed: boolean;
  aiParsedData: Record<string, unknown> | null;
  confidenceScore: string | null;
};

type FollowUpTracking = {
  id: number;
  processId: number;
  documentsReceivedAt: string | null;
  preInspectionAt: string | null;
  savedToFolderAt: string | null;
  ncmVerifiedAt: string | null;
  ncmBlCheckedAt: string | null;
  freightBlCheckedAt: string | null;
  espelhoBuiltAt: string | null;
  invoiceSentFeniciaAt: string | null;
  espelhoGeneratedAt: string | null;
  signaturesCollectedAt: string | null;
  signedDocsSentAt: string | null;
  sentToFeniciaAt: string | null;
  diDraftAt: string | null;
  liSubmittedAt: string | null;
  liApprovedAt: string | null;
  liDeadline: string | null;
  overallProgress: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Espelha `ImportProcess` de apps/web/src/shared/types/index.ts. */
export interface FixtureProcess {
  id: number;
  processCode: string;
  brand: string;
  status: ProcessStatus;
  logisticStatus: string | null;
  incoterm: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  etd: string | null;
  eta: string | null;
  shipmentDate: string | null;
  etaActual: string | null;
  customsClearanceAt: string | null;
  cdArrivalAt: string | null;
  exporterName: string | null;
  exporterAddress: string | null;
  importerName: string | null;
  importerAddress: string | null;
  totalFobValue: string | null;
  freightValue: string | null;
  insuranceValue: string | null;
  customsValue: string | null;
  registrationDollar: string | null;
  totalBoxes: number | null;
  totalNetWeight: string | null;
  totalGrossWeight: string | null;
  totalCbm: string | null;
  containerType: string | null;
  vesselName: string | null;
  blNumber: string | null;
  shippingLine: string | null;
  diNumber: string | null;
  duimpNumber: string | null;
  registeredAt: string | null;
  customsChannel: string | null;
  freightAgent: string | null;
  inspectionType: string | null;
  hasLiItems: boolean;
  hasCertification: boolean;
  hasFreeOfCharge: boolean;
  correctionStatus: string | null;
  previousCodes: string[] | null;
  lockedAt: string | null;
  lockedReason: string | null;
  paymentTerms: Record<string, unknown> | null;
  aiExtractedData: Record<string, unknown> | null;
  notes: string | null;
  urgentNote: string | null;
  driveFolderId: string | null;
  sistemaDriveFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  documents: ProcessDocument[];
  followUp: FollowUpTracking | null;
}

/** Numero de etapa (0-8) do status na esteira; cancelado conta como 0. */
function stageOf(status: ProcessStatus): number {
  const idx = STATUSES.indexOf(status);
  return status === 'cancelled' ? 0 : idx;
}

function money(value: number): string {
  return value.toFixed(2);
}

function makeDocuments(id: number, stage: number): ProcessDocument[] {
  if (stage === 0) return [];
  const base = id * 10;
  const docs: ProcessDocument[] = [
    {
      id: base + 1,
      type: 'invoice',
      originalFilename: `COMMERCIAL INVOICE ${2026}-${String(id).padStart(4, '0')} - Shenzhen Guangming Textile - FINAL REV3.pdf`,
      isProcessed: true,
      aiParsedData: { invoiceNumber: `INV-GM-${26000 + id}`, totalFobValue: 125000 + id * 731.5 },
      confidenceScore: '0.93',
    },
    {
      id: base + 2,
      type: 'packing_list',
      originalFilename: `PL_${id}_puket_inverno.pdf`,
      isProcessed: stage >= 2,
      aiParsedData: stage >= 2 ? { totalBoxes: 812 + id, totalGrossWeight: 9834.5 } : null,
      confidenceScore: stage >= 2 ? '0.88' : null,
    },
  ];
  if (stage >= 2) {
    docs.push({
      id: base + 3,
      type: 'ohbl',
      originalFilename: `OHBL MEDUAB${100000 + id}.pdf`,
      isProcessed: stage >= 3,
      aiParsedData: stage >= 3 ? { blNumber: `MEDUAB${100000 + id}` } : { extractionFailed: true },
      confidenceScore: stage >= 3 ? '0.71' : '0.42',
    });
  }
  if (stage >= 4) {
    docs.push({
      id: base + 4,
      type: 'espelho',
      originalFilename: `Espelho ${2026}-${String(id).padStart(4, '0')}.xlsx`,
      isProcessed: true,
      aiParsedData: null,
      confidenceScore: null,
    });
  }
  return docs;
}

function makeFollowUp(id: number, stage: number, createdDaysAgo: number): FollowUpTracking | null {
  if (stage === 0) return null;
  const at = (minStage: number, offset: number) =>
    stage >= minStage ? iso(-createdDaysAgo + offset, 9 + (offset % 8), (id * 7) % 60) : null;
  const progress = Math.min(100, Math.round((stage / 8) * 100));
  return {
    id: 500 + id,
    processId: id,
    documentsReceivedAt: at(1, 1),
    preInspectionAt: at(2, 2),
    savedToFolderAt: at(2, 2),
    ncmVerifiedAt: at(2, 3),
    ncmBlCheckedAt: at(3, 4),
    freightBlCheckedAt: at(3, 4),
    espelhoBuiltAt: at(4, 5),
    invoiceSentFeniciaAt: at(4, 5),
    espelhoGeneratedAt: at(4, 6),
    signaturesCollectedAt: at(5, 7),
    signedDocsSentAt: at(5, 7),
    sentToFeniciaAt: at(5, 8),
    diDraftAt: at(6, 9),
    liSubmittedAt: at(6, 9),
    liApprovedAt: at(7, 12),
    liDeadline: stage >= 6 && stage < 7 ? day(3 + (id % 9) - 4) : null,
    overallProgress: progress,
    notes:
      id % 4 === 0
        ? 'Aguardando retorno da Fenicia sobre a numeracao da DUIMP; despachante avisou que o recinto alfandegado esta com fila de 6 dias para vistoria fisica.'
        : null,
    createdAt: iso(-createdDaysAgo),
    updatedAt: iso(-Math.max(0, createdDaysAgo - stage * 2 - (id % 5))),
  };
}

function makeProcess(id: number, forcedStatus?: ProcessStatus): FixtureProcess {
  const status = forcedStatus ?? STATUSES[(id - 1) % STATUSES.length];
  const stage = stageOf(status);
  const brand = id % 5 === 0 ? 'imaginarium' : id % 7 === 0 ? 'colecao especial' : 'puket';
  const createdDaysAgo = 4 + id * 6;
  const etdOffset = -createdDaysAgo + 20;
  const etaOffset = etdOffset + 32;
  const fob = 48250.75 + id * 17_913.37 + (id % 3) * 100_000;
  const freight = 3850 + id * 412.25;
  const channel = CHANNELS[id % CHANNELS.length];
  const exporter = EXPORTERS[(id - 1) % EXPORTERS.length];

  const numerario =
    id % 3 === 1
      ? {
          valorNumerario: (fob * 5.42 * 0.35).toFixed(2),
          percentualNumerario: id % 2 === 0 ? 100 : 35 + (id % 4) * 12.5,
          dataPgtoNumerario: day(-createdDaysAgo + 15),
          solicitanteNumerario: 'Eduarda Fiscal e Aduaneira',
          dadosCambio:
            'Banco Itau, contrato 1234567890, taxa 5,4231 fechada em 3 parcelas; saldo remanescente a liquidar em ate 30 dias apos o registro da DUIMP',
        }
      : {};

  const desembaraco =
    stage >= 4
      ? {
          numeroDI: `26/${String(1_000_000 + id * 9_137).padStart(7, '0')}-${id % 10}`,
          dataRegistroDI: day(etaOffset + 2),
          // Divergencia proposital coluna x planilha nos multiplos de 6.
          canal:
            id % 6 === 0 ? 'Amarelo' : channel ? channel[0].toUpperCase() + channel.slice(1) : null,
          desembaraco: stage >= 5 ? day(etaOffset + 6) : null,
          chegadaCD: stage >= 7 ? day(etaOffset + 11) : null,
          recinto: id % 2 === 0 ? 'Santos Brasil Terminal Portuario (CLIA)' : 'Porto Itapoa',
          freeTime: 7 + (id % 3) * 7,
          alertaDemurrage: id % 4 === 0 ? 'SIM - 3 dias estourados' : 'Nao',
        }
      : {};

  const aiExtractedData: Record<string, unknown> | null =
    stage === 0
      ? null
      : {
          invoice: {
            invoiceNumber: `INV-GM-${26000 + id}`,
            exporterName: exporter,
            exporterAddress: EXPORTER_ADDRESSES[id % EXPORTER_ADDRESSES.length],
            importerName: 'Uni.co Comercio de Presentes e Confeccoes Ltda.',
            importerAddress:
              'Rodovia BR-101, km 212, Galpao 4, Distrito Industrial, Sao Jose - SC, CEP 88104-800',
            portOfLoading: PORTS_LOADING[id % PORTS_LOADING.length],
            portOfDischarge: PORTS_DISCHARGE[id % PORTS_DISCHARGE.length],
            incoterm: id % 4 === 0 ? 'CIF' : 'FOB',
            totalFobValue: fob,
            freightValue: id % 3 === 0 ? 0 : freight,
            freightCurrency: id % 3 === 0 ? 'COLLECT' : 'USD',
            totalBoxes: 812 + id * 13,
            totalNetWeight: 8123.456 + id * 55.5,
            totalGrossWeight: 9834.5 + id * 61.25,
            totalCbm: 66.128 + id * 1.375,
            containerType: CONTAINERS[id % CONTAINERS.length],
            containerNumber: `MSCU${String(4_000_000 + id * 337).padStart(7, '0')}`,
          },
          ohbl:
            stage >= 2
              ? {
                  blNumber: `MEDUAB${100000 + id}`,
                  vessel: VESSELS[id % VESSELS.length],
                  shipmentDate: day(etdOffset),
                  etd: day(etdOffset),
                  eta: day(etaOffset),
                  freightValue: freight,
                  freightCurrency: 'USD',
                }
              : undefined,
          espelho:
            stage >= 4
              ? {
                  summary: {
                    totalAmountUsd: fob,
                    freightValue: freight,
                    freightCurrency: 'USD',
                    shippingLine: SHIPPING_LINES[id % SHIPPING_LINES.length],
                    etd: day(etdOffset),
                    eta: day(etaOffset),
                    shipmentDate: day(etdOffset),
                    containerType: CONTAINERS[id % CONTAINERS.length],
                  },
                  items: [
                    {
                      fornecedor: exporter,
                      descricao:
                        'Meia infantil em algodao penteado com estampa de dinossauro, cano medio, embalagem com 3 pares, tamanhos 17-20 / 21-24 / 25-28',
                      ncm: '6115.95.00',
                      quantidade: 12_480,
                      valorUnitario: 1.37,
                    },
                    {
                      fornecedor: exporter,
                      descricao: 'Pantufa adulto microfibra com solado antiderrapante',
                      ncm: '6405.20.00',
                      quantidade: 3_120,
                      valorUnitario: 4.85,
                    },
                  ],
                }
              : undefined,
          ...numerario,
          ...desembaraco,
        };

  const notes =
    id === 1
      ? [
          'Processo com DOIS embarques parciais consolidados no mesmo BL master; o segundo container (MSCU4001337) saiu de Yantian 4 dias depois do primeiro e o armador ainda nao corrigiu o manifesto.',
          '',
          'Pendencias:',
          '1) Fenicia precisa reenviar o draft da DUIMP com a NCM 6115.95.00 corrigida (estava 6115.96.00).',
          '2) Certificado Inmetro do lote de pantufas vence em 12 dias — verificar se a renovacao ja foi protocolada.',
          '3) NF de entrada emitida parcialmente; o CD recebeu 812 volumes de 1.041 e o restante esta no recinto aguardando vistoria fisica (canal vermelho).',
          '',
          'Observacao longa proposital para testar a quebra de linha, o whitespace-pre-wrap e o comportamento do cartao em telas estreitas (320px) e largas (1920px).',
        ].join('\n')
      : id % 3 === 0
        ? 'Internalizado com NF 000.123.456 emitida; conferencia fisica sem divergencias. Frete internacional pago pelo exportador (COLLECT).'
        : id % 5 === 0
          ? 'Cliente pediu prioridade por causa da campanha de Dia das Criancas; ETA original perdida por atraso na atracacao em Santos.'
          : null;

  return {
    id,
    processCode: `IMP-2026-${String(id).padStart(4, '0')} ${brand === 'imaginarium' ? 'IMAGINARIUM' : 'PUKET'}${id === 1 ? ' INVERNO CONSOLIDADO YANTIAN' : ''}`,
    brand,
    status,
    logisticStatus:
      id === 1
        ? 'customs_inspection'
        : id % 4 === 0
          ? LOGISTIC_STAGES[Math.min(LOGISTIC_STAGES.length - 1, stage + 2)]
          : null,
    incoterm: stage === 0 && id !== 1 ? null : id % 4 === 0 ? 'CIF' : 'FOB',
    portOfLoading: stage === 0 ? null : PORTS_LOADING[id % PORTS_LOADING.length],
    portOfDischarge: stage === 0 ? null : PORTS_DISCHARGE[id % PORTS_DISCHARGE.length],
    etd: stage === 0 && id % 2 === 0 ? null : day(etdOffset),
    eta: stage === 0 ? null : day(etaOffset),
    shipmentDate: stage >= 2 ? day(etdOffset) : null,
    etaActual: stage >= 3 ? day(etaOffset + (id % 3 === 0 ? 4 : 0)) : null,
    customsClearanceAt: stage >= 5 ? iso(etaOffset + 6) : null,
    cdArrivalAt: stage >= 7 ? iso(etaOffset + 11) : null,
    exporterName: stage === 0 ? (id === 1 ? exporter : null) : exporter,
    exporterAddress: stage >= 1 ? EXPORTER_ADDRESSES[id % EXPORTER_ADDRESSES.length] : null,
    importerName: 'Uni.co Comercio de Presentes e Confeccoes Ltda.',
    importerAddress:
      stage >= 1
        ? 'Rodovia BR-101, km 212, Galpao 4, Distrito Industrial, Sao Jose - SC, CEP 88104-800'
        : null,
    totalFobValue: stage === 0 && id % 2 === 0 ? null : money(fob),
    freightValue: stage >= 2 ? money(freight) : null,
    insuranceValue: stage >= 4 ? money(fob * 0.0035) : null,
    customsValue: stage >= 4 ? money((fob + freight) * 5.4231) : null,
    registrationDollar: stage >= 4 ? '5.4231' : null,
    totalBoxes: stage >= 1 ? 812 + id * 13 : null,
    totalNetWeight: stage >= 1 ? (8123.456 + id * 55.5).toFixed(3) : null,
    totalGrossWeight: stage >= 1 ? (9834.5 + id * 61.25).toFixed(3) : null,
    totalCbm: stage >= 1 ? (66.128 + id * 1.375).toFixed(3) : null,
    containerType: stage >= 1 ? CONTAINERS[id % CONTAINERS.length] : null,
    vesselName: stage >= 2 ? VESSELS[id % VESSELS.length] : null,
    blNumber: stage >= 2 ? `MEDUAB${100000 + id}` : null,
    shippingLine: stage >= 2 ? SHIPPING_LINES[id % SHIPPING_LINES.length] : null,
    diNumber:
      stage >= 4 ? `26/${String(1_000_000 + id * 9_137).padStart(7, '0')}-${id % 10}` : null,
    duimpNumber: stage >= 4 ? `26BR${String(10_000_000_000 + id * 77_777).slice(-11)}` : null,
    registeredAt: stage >= 4 ? day(etaOffset + 2) : null,
    customsChannel: stage >= 4 ? (id % 6 === 0 ? 'verde' : channel) : null,
    freightAgent: stage >= 2 ? FREIGHT_AGENTS[id % FREIGHT_AGENTS.length] : null,
    inspectionType: stage >= 5 ? INSPECTIONS[id % INSPECTIONS.length] : null,
    hasLiItems: id % 2 === 1,
    hasCertification: id % 3 === 1,
    hasFreeOfCharge: id % 4 === 1,
    correctionStatus:
      id === 1 ? 'aguardando correcao do exportador' : id % 9 === 5 ? 'em correcao' : null,
    previousCodes:
      id === 1
        ? ['IMP-2025-0418 PUKET', 'IMP-2026-0007 PUKET']
        : id === 8
          ? ['IMP-2026-0008 IMAG']
          : null,
    lockedAt: id === 3 ? iso(-2, 16, 45) : null,
    lockedReason: id === 3 ? 'Aprovado pelo Vimbar em 04/09/2026 (SYDLE #48213)' : null,
    paymentTerms:
      id === 1
        ? {
            description:
              '30% de sinal na confirmacao do pedido (TT), 70% contra copia do BL, com desconto de 1,5% para pagamento antecipado em ate 5 dias uteis',
            depositPercent: 30,
            balancePercent: 70,
            paymentDays: 45,
          }
        : id % 3 === 0
          ? { depositPercent: 30, balancePercent: 70, paymentDays: 60 }
          : id % 3 === 1
            ? { days: 30, type: 'net' }
            : null,
    aiExtractedData,
    notes,
    urgentNote:
      id === 1
        ? 'URGENTE: container retido no canal vermelho, demurrage comeca a contar em 48h. Priorizar vistoria fisica com o despachante HOJE.'
        : id === 6
          ? 'LI vence em 2 dias.'
          : null,
    driveFolderId: stage >= 1 ? `1AbCdEfGhIjKlMnOpQrStUvWxYz${id}` : null,
    sistemaDriveFolderId: stage >= 2 ? `1SySdRiVe${id}AutoFolderXYZ` : null,
    createdAt: iso(-createdDaysAgo, 8, 15),
    updatedAt: iso(-Math.max(0, createdDaysAgo - stage * 3), 17, 5),
    documents: makeDocuments(id, stage),
    followUp: makeFollowUp(id, stage, createdDaysAgo),
  };
}

/** 24 processos; o id 1 e o mais completo e urgente. */
export const PROCESSES: FixtureProcess[] = Array.from({ length: 24 }, (_, i) => makeProcess(i + 1));

// Ajustes pontuais para garantir cobertura: o id 1 fica em li_pending com
// tudo preenchido (stage 6) e um cancelado recente aparece no topo da lista.
const PROCESS_1_BASE = makeProcess(1, 'li_pending');
PROCESSES[0] = {
  ...PROCESS_1_BASE,
  customsChannel: 'vermelho',
  inspectionType: 'Inmetro',
  followUp: makeFollowUp(1, 6, 10),
  documents: makeDocuments(1, 6),
  aiExtractedData: {
    ...PROCESS_1_BASE.aiExtractedData,
    ...{
      ohbl: {
        blNumber: 'MEDUAB100001',
        vessel: 'MSC GULSUN',
        shipmentDate: day(-40),
        etd: day(-40),
        eta: day(-8),
        freightValue: 4262.25,
        freightCurrency: 'USD',
      },
      espelho: {
        summary: {
          totalAmountUsd: 166164.12,
          freightValue: 4262.25,
          freightCurrency: 'USD',
          shippingLine: 'MSC',
          etd: day(-40),
          eta: day(-8),
          shipmentDate: day(-40),
          containerType: '2 x 40HC',
          containerNumber: 'MSCU4000337 / MSCU4001337',
        },
        items: [
          {
            fornecedor: 'Shenzhen Guangming Textile Import & Export Co., Ltd.',
            descricao:
              'Meia infantil em algodao penteado com estampa de dinossauro, cano medio, embalagem com 3 pares, tamanhos 17-20 / 21-24 / 25-28',
            ncm: '6115.95.00',
            quantidade: 12_480,
            valorUnitario: 1.37,
          },
        ],
      },
      numeroDI: '26/1009137-1',
      dataRegistroDI: day(-6),
      canal: 'Vermelho',
      desembaraco: null,
      chegadaCD: null,
      recinto: 'Santos Brasil Terminal Portuario (CLIA)',
      freeTime: 14,
      alertaDemurrage: 'SIM - 3 dias estourados',
      valorNumerario: '315402.18',
      percentualNumerario: 35,
      dataPgtoNumerario: day(-12),
      solicitanteNumerario: 'Eduarda Fiscal e Aduaneira',
      dadosCambio:
        'Banco Itau, contrato 1234567890, taxa 5,4231 fechada em 3 parcelas; saldo remanescente a liquidar em ate 30 dias apos o registro da DUIMP',
    },
  },
  etd: day(-40),
  eta: day(-8),
  shipmentDate: day(-40),
  etaActual: day(-6),
  registeredAt: day(-6),
  diNumber: '26/1009137-1',
  duimpNumber: '26BR00000077777',
  customsClearanceAt: null,
  cdArrivalAt: null,
  totalFobValue: '166164.12',
  freightValue: '4262.25',
  insuranceValue: '581.57',
  customsValue: '924213.44',
  registrationDollar: '5.4231',
  createdAt: iso(-10, 8, 15),
  updatedAt: iso(0, 7, 55),
};
PROCESSES[1] = {
  ...PROCESSES[1],
  status: 'cancelled',
  createdAt: iso(-1, 14, 0),
  updatedAt: iso(0, 9, 0),
};

function findProcess(id: number): FixtureProcess | undefined {
  return PROCESSES.find((p) => p.id === id);
}

/** Lista com os filtros que ProcessListPage manda na query string. */
function filterProcesses(url: URL): FixtureProcess[] {
  const status = url.searchParams.get('status');
  const brand = url.searchParams.get('brand');
  const search = url.searchParams.get('search')?.toLowerCase();
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  return PROCESSES.filter((p) => {
    if (status && p.status !== status) return false;
    if (brand && p.brand !== brand) return false;
    if (search && !p.processCode.toLowerCase().includes(search)) return false;
    const created = p.createdAt.slice(0, 10);
    if (startDate && created < startDate) return false;
    if (endDate && created > endDate) return false;
    return true;
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ── Alertas ──────────────────────────────────────────────────────────────

const ALERT_TEMPLATES: Array<{
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
}> = [
  {
    severity: 'critical',
    title: 'Demurrage iniciando',
    message:
      'O container MSCU4000337 do processo ultrapassou o free time de 14 dias no terminal Santos Brasil; a partir de amanha o armador MSC cobra USD 185,00 por dia por container ate a retirada. Providenciar a liberacao junto ao despachante e confirmar o agendamento do transporte rodoviario.',
  },
  {
    severity: 'critical',
    title: 'LI vencendo em 48h',
    message:
      'A Licenca de Importacao do lote de pantufas (Inmetro) vence em 2 dias e o deferimento ainda nao saiu no Portal Unico.',
  },
  {
    severity: 'warning',
    title: 'Divergencia de peso bruto',
    message:
      'Packing list informa 9.834,500 kg e o BL informa 9.912,000 kg (diferenca de 0,79%). Verificar se o armador considerou o peso da paletizacao.',
  },
  {
    severity: 'warning',
    title: 'Documentos atrasados',
    message:
      'Embarque realizado ha 11 dias e a invoice final ainda nao foi recebida do exportador.',
  },
  {
    severity: 'info',
    title: 'Espelho gerado',
    message: 'Espelho gerado automaticamente a partir dos documentos processados pela IA.',
  },
  {
    severity: 'info',
    title: 'E-mail processado',
    message:
      'E-mail de "Shenzhen Guangming Textile Import & Export Co., Ltd." com 4 anexos foi vinculado ao processo pelo codigo no assunto.',
  },
  {
    severity: 'warning',
    title: 'Sem atualizacao no follow-up',
    message: 'Processo sem nenhuma atualizacao no follow-up ha 9 dias.',
  },
  {
    severity: 'critical',
    title: 'Validacao com 5 falhas',
    message:
      'Checks reprovados: exporter-match, ports-match, fob-calculation, ncm-bl-description, freight-vs-fup. Abrir a aba Comparativo antes de enviar para a Fenicia.',
  },
];

export const ALERTS = Array.from({ length: 60 }, (_, i) => {
  const id = 6001 + i;
  const tpl = ALERT_TEMPLATES[i % ALERT_TEMPLATES.length];
  const proc = i % 9 === 8 ? null : PROCESSES[i % PROCESSES.length];
  const acknowledged = i % 4 === 3;
  const sentToChat = i % 3 !== 2;
  const createdAt = iso(-Math.floor(i / 3), 8 + (i % 10), (i * 13) % 60);
  return {
    id,
    processId: proc?.id ?? null,
    processCode: proc?.processCode ?? null,
    severity: tpl.severity,
    title: tpl.title,
    message: tpl.message,
    sentToChat,
    sentAt: sentToChat ? createdAt : null,
    acknowledged,
    acknowledgedBy: acknowledged ? 'Nicolas Matsuda Auditoria' : null,
    acknowledgedAt: acknowledged ? iso(-Math.floor(i / 3), 18, 0) : null,
    createdAt,
  };
});

function filterAlerts(url: URL) {
  const severity = url.searchParams.get('severity');
  const acknowledged = url.searchParams.get('acknowledged');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const processId = url.searchParams.get('processId');
  return ALERTS.filter((a) => {
    if (severity && a.severity !== severity) return false;
    if (acknowledged === 'true' && !a.acknowledged) return false;
    if (acknowledged === 'false' && a.acknowledged) return false;
    if (processId && String(a.processId) !== processId) return false;
    const created = a.createdAt.slice(0, 10);
    if (startDate && created < startDate) return false;
    if (endDate && created > endDate) return false;
    return true;
  });
}

// ── E-mails ingeridos ────────────────────────────────────────────────────

const EMAIL_STATUSES = [
  'completed',
  'failed',
  'pending',
  'processing',
  'ignored',
  'reprocessed',
] as const;

export const EMAIL_LOGS = Array.from({ length: 30 }, (_, i) => {
  const id = 9001 + i;
  const status = EMAIL_STATUSES[i % EMAIL_STATUSES.length];
  const proc = i % 6 === 4 ? null : PROCESSES[i % PROCESSES.length];
  const attachmentsCount = (i % 5) + (i % 2 === 0 ? 1 : 0);
  const processed = status === 'completed' || status === 'reprocessed' ? attachmentsCount : 0;
  return {
    id,
    messageId: `<CAF+x${id}z9qWqL7@mail.gmail.com>`,
    fromAddress:
      i % 3 === 0
        ? 'export.department.guangming.textile.shenzhen@guangming-textile-group-international.com.cn'
        : i % 3 === 1
          ? 'operacional@fenicialogistica.com.br'
          : 'noreply@msc.com',
    subject:
      i % 4 === 0
        ? `RE: RE: FW: ${proc?.processCode ?? 'SEM PROCESSO'} - Shipping documents (Commercial Invoice, Packing List, OHBL draft) - please confirm consignee details before Friday`
        : i % 4 === 1
          ? `Arrival Notice ${proc?.blNumber ?? 'MEDUAB000000'} - MSC GULSUN V.NA632A`
          : i % 4 === 2
            ? `${proc?.processCode ?? ''} Draft DUIMP para conferencia`
            : 'Newsletter semanal de tarifas',
    receivedAt: iso(-Math.floor(i / 2), 6 + (i % 12), (i * 17) % 60),
    processId: proc ? String(proc.id) : null,
    status,
    attachmentsCount,
    processedAttachments: processed,
    processedAttachmentsCount: processed,
    processedAttachmentDetails:
      processed > 0
        ? Array.from({ length: processed }, (_, k) => ({
            filename: `anexo_${k + 1}_${id}.pdf`,
            type: ['invoice', 'packing_list', 'ohbl', 'other'][k % 4],
            documentId: String(700 + i * 4 + k),
          }))
        : [],
    processCode: proc?.processCode ?? null,
    errorMessage:
      status === 'failed'
        ? 'Anexo "PL_final_v3 (1).xlsx" excede 20 MB; extracao abortada apos 3 tentativas (timeout 30s) na chamada ao modelo.'
        : null,
    createdAt: iso(-Math.floor(i / 2), 6 + (i % 12), (i * 17) % 60),
  };
});

function filterEmailLogs(url: URL) {
  const processId = url.searchParams.get('processId');
  const status = url.searchParams.get('status');
  return EMAIL_LOGS.filter((log) => {
    if (processId && log.processId !== processId) return false;
    if (status && log.status !== status) return false;
    return true;
  });
}

// ── Follow-up (kanban) ───────────────────────────────────────────────────

/** Linhas cruas do follow-up; a tela deriva a coluna pelo ultimo marco preenchido. */
const FOLLOW_UP_BASE = PROCESSES.filter((p) => p.followUp && p.status !== 'cancelled');
export const FOLLOW_UP_ROWS = FOLLOW_UP_BASE.concat(FOLLOW_UP_BASE.slice(0, 8)).map((p, i) => {
  const fu = p.followUp!;
  // Os 8 ultimos sao reembarques parciais: mesmo processo, card duplicado.
  const isDuplicate = i >= FOLLOW_UP_BASE.length;
  const stageIdx = i % 7; // distribui nas 7 colunas do kanban
  const daysSinceUpdate = [0, 2, 4, 6, 8, 12, 20][i % 7];
  return {
    id: fu.id + (isDuplicate ? 1000 : 0),
    processId: p.id,
    processCode: isDuplicate ? `${p.processCode} (REEMBARQUE PARCIAL)` : p.processCode,
    brand: p.brand,
    status: p.status,
    documentsReceivedAt: stageIdx >= 0 ? iso(-30 + i) : null,
    preInspectionAt: stageIdx >= 1 ? iso(-28 + i) : null,
    ncmVerifiedAt: stageIdx >= 2 ? iso(-26 + i) : null,
    espelhoGeneratedAt: stageIdx >= 3 ? iso(-24 + i) : null,
    sentToFeniciaAt: stageIdx >= 4 ? iso(-22 + i) : null,
    liSubmittedAt: stageIdx >= 5 ? iso(-20 + i) : null,
    liApprovedAt: stageIdx >= 6 ? iso(-18 + i) : null,
    overallProgress: Math.round((stageIdx / 7) * 100),
    updatedAt: iso(-daysSinceUpdate, 15, 20),
    createdAt: iso(-45 + (i % 10), 8, 0),
  };
});

export const LI_DEADLINES = [
  {
    processId: 1,
    processCode: PROCESSES[0].processCode,
    brand: 'puket',
    liDeadline: day(2),
    daysRemaining: 2,
  },
  {
    processId: 7,
    processCode: PROCESSES[6].processCode,
    brand: 'colecao especial',
    liDeadline: day(-1),
    daysRemaining: -1,
  },
  {
    processId: 13,
    processCode: PROCESSES[12].processCode,
    brand: 'puket',
    liDeadline: day(0),
    daysRemaining: 0,
  },
  {
    processId: 5,
    processCode: PROCESSES[4].processCode,
    brand: 'imaginarium',
    liDeadline: day(5),
    daysRemaining: 5,
  },
  {
    processId: 10,
    processCode: PROCESSES[9].processCode,
    brand: 'imaginarium',
    liDeadline: day(7),
    daysRemaining: 7,
  },
  {
    processId: 16,
    processCode: PROCESSES[15].processCode,
    brand: 'puket',
    liDeadline: day(12),
    daysRemaining: 12,
  },
  {
    processId: 19,
    processCode: PROCESSES[18].processCode,
    brand: 'puket',
    liDeadline: day(21),
    daysRemaining: 21,
  },
  {
    processId: 22,
    processCode: PROCESSES[21].processCode,
    brand: 'puket',
    liDeadline: day(34),
    daysRemaining: 34,
  },
];

// ── LI tracking ──────────────────────────────────────────────────────────

const LI_STATUSES = ['pending', 'submitted', 'deferred', 'expired', 'cancelled'] as const;
const LI_ORGAOS = ['Inmetro', 'MAPA', 'Anvisa', 'DECEX', 'Ibama'] as const;
const LI_DESCRIPTIONS = [
  'Pantufa adulto em microfibra com solado de EVA antiderrapante, modelos unicornio e preguica, tamanhos 34-35 ao 42-43',
  'Luminaria decorativa LED formato lua cheia, 15 cm, alimentacao USB, com controle remoto',
  'Brinquedo de pelucia urso 40 cm com enchimento de fibra siliconada',
  'Caneca ceramica 350 ml com decalque vitrificado',
  'Meia infantil algodao penteado, cano medio, 3 pares',
];

export const LI_ITEMS = Array.from({ length: 33 }, (_, i) => {
  const id = 3001 + i;
  const status = LI_STATUSES[i % LI_STATUSES.length];
  const proc = i % 11 === 10 ? null : PROCESSES[(i * 3) % PROCESSES.length];
  const requested = -60 + i;
  return {
    id,
    processId: proc?.id ?? null,
    processCode: proc?.processCode ?? `IMP-2025-0${400 + i} PUKET (ARQUIVADO)`,
    orgao: i % 7 === 6 ? null : LI_ORGAOS[i % LI_ORGAOS.length],
    ncm:
      i % 8 === 7
        ? null
        : ['6405.20.00', '9405.21.00', '9503.00.99', '6912.00.00', '6115.95.00'][i % 5],
    item: `Item ${String((i % 12) + 1).padStart(3, '0')}`,
    description: LI_DESCRIPTIONS[i % LI_DESCRIPTIONS.length],
    supplier: EXPORTERS[i % EXPORTERS.length],
    requestedByCompanyAt: i % 6 === 5 ? null : day(requested),
    submittedToFeniciaAt: status === 'pending' ? null : day(requested + 3),
    deferredAt: status === 'deferred' ? day(requested + 18) : null,
    expectedDeferralAt: status === 'submitted' ? day(requested + 25) : null,
    averageDays: status === 'pending' ? null : 15 + (i % 9),
    validUntil:
      status === 'deferred'
        ? day(requested + 18 + 90)
        : status === 'expired'
          ? day(requested - 30)
          : null,
    lpcoNumber:
      status === 'deferred' || status === 'expired'
        ? `I${String(2600000000 + i * 4111).slice(0, 10)}`
        : null,
    etdOrigem: proc?.etd ?? null,
    etaArmador: proc?.eta ?? null,
    status,
    itemStatus: status === 'deferred' ? 'liberado' : null,
    observations:
      i % 4 === 0
        ? 'Exigencia do orgao anuente: apresentar laudo de ensaio atualizado (norma ABNT NBR 15.236) e foto da etiqueta de composicao.'
        : null,
    brand: proc?.brand,
  };
});

function filterLiItems(url: URL) {
  const status = url.searchParams.get('status');
  const orgao = url.searchParams.get('orgao');
  const processCode = url.searchParams.get('processCode')?.toLowerCase();
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  return LI_ITEMS.filter((li) => {
    if (status && li.status !== status) return false;
    if (orgao && li.orgao !== orgao) return false;
    if (processCode && !li.processCode.toLowerCase().includes(processCode)) return false;
    const requested = li.requestedByCompanyAt ?? '';
    if (startDate && requested && requested < startDate) return false;
    if (endDate && requested && requested > endDate) return false;
    return true;
  });
}

function countBy<T>(
  items: T[],
  pick: (item: T) => string | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = pick(item);
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// ── Cambio ───────────────────────────────────────────────────────────────

/** Lancamentos de cambio dos processos 1..8 (numeros, como a tela de cambios le). */
export const CURRENCY_EXCHANGES = PROCESSES.slice(0, 8).flatMap((p, pi) => {
  const rows = pi === 0 ? 6 : (pi % 3) + 1;
  return Array.from({ length: rows }, (_, k) => {
    const id = 800 + pi * 10 + k;
    const type = k % 2 === 0 ? 'balance' : 'deposit';
    const amountUsd = Number(
      (Number(p.totalFobValue ?? 50000) * (k === 0 ? 0.7 : 0.3) + k * 1234.56).toFixed(2),
    );
    const exchangeRate = Number((5.1234 + pi * 0.0417 + k * 0.0093).toFixed(4));
    return {
      id,
      processId: String(p.id),
      type: type as 'balance' | 'deposit',
      amountUsd,
      exchangeRate,
      amountBrl: Number((amountUsd * exchangeRate).toFixed(2)),
      paymentDeadline: day(-20 + pi * 5 + k * 7),
      expirationDate: day(-20 + pi * 5 + k * 7 + 30),
      notes:
        k === 0
          ? 'Contrato de cambio 2026-0042-BR fechado com o Banco Itau; parcela referente ao sinal de 30% conforme proforma revisada em julho'
          : k === 1
            ? null
            : 'Saldo',
      createdAt: iso(-30 + pi * 3 + k, 11, 0),
    };
  });
});

function exchangesForProcess(id: string) {
  return CURRENCY_EXCHANGES.filter((e) => e.processId === id);
}

function exchangeTotals(id: string) {
  const exchanges = exchangesForProcess(id);
  const sum = (type: 'balance' | 'deposit', key: 'amountUsd' | 'amountBrl') =>
    exchanges
      .filter((e) => e.type === type)
      .reduce((acc, e) => acc + e[key], 0)
      .toFixed(2);
  return {
    exchanges: exchanges.map((e) => ({
      ...e,
      amountUsd: e.amountUsd.toFixed(2),
      exchangeRate: e.exchangeRate.toFixed(4),
      amountBrl: e.amountBrl.toFixed(2),
    })),
    totals: {
      totalBalanceUsd: sum('balance', 'amountUsd'),
      totalBalanceBrl: sum('balance', 'amountBrl'),
      totalDepositUsd: sum('deposit', 'amountUsd'),
      totalDepositBrl: sum('deposit', 'amountBrl'),
    },
  };
}

// ── Dashboard ────────────────────────────────────────────────────────────

const activeProcesses = PROCESSES.filter((p) => !['completed', 'cancelled'].includes(p.status));
const totalFob = PROCESSES.reduce((acc, p) => acc + Number(p.totalFobValue ?? 0), 0);

export const DASHBOARD_OVERVIEW = {
  activeProcesses: activeProcesses.length,
  overdueProcesses: 7,
  completedThisMonth: 4,
  totalFobValue: Number(totalFob.toFixed(2)),
  recentAlerts: ALERTS.slice(0, 5).map((a) => ({
    id: a.id,
    message: a.message,
    severity: a.severity,
    createdAt: a.createdAt,
  })),
  recentProcesses: [...PROCESSES]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      status: p.status,
      etd: p.etd,
      createdAt: p.createdAt,
    })),
};

export const DASHBOARD_BY_STATUS = STATUSES.map((status) => ({
  status,
  count: PROCESSES.filter((p) => p.status === status).length + (status === 'validating' ? 9 : 0),
}));

export const DASHBOARD_BY_MONTH = Array.from({ length: 12 }, (_, i) => {
  const monthsAgo = 11 - i;
  return {
    month: monthLabel(monthsAgo),
    count: [3, 5, 4, 8, 11, 6, 9, 14, 7, 12, 10, 13][i],
    fobValue: Number(
      ([3, 5, 4, 8, 11, 6, 9, 14, 7, 12, 10, 13][i] * 131_477.83 + i * 9_999.99).toFixed(2),
    ),
  };
});

export const DASHBOARD_FOB_BY_BRAND = [
  { brand: 'puket', totalFob: 2_734_512.87 },
  { brand: 'imaginarium', totalFob: 1_188_020.4 },
  { brand: 'colecao especial', totalFob: 96_450.12 },
];

export const DASHBOARD_EXECUTIVE = {
  totalProcesses: PROCESSES.length + 93,
  activeProcesses: activeProcesses.length,
  completedThisMonth: 4,
  completedChange: 33,
  totalFobThisMonth: '1834271.55',
  fobChange: -12,
  validationPassRate: 87,
  pendingPayments: { count: 6, totalUsd: '412987.31' },
  espelhosGenerated: 11,
  emailsSent: 38,
};

export const DASHBOARD_EXECUTIVE_TIMELINE = [
  { status: 'draft', count: 5, avgDaysInStatus: 2.4 },
  { status: 'documents_received', count: 9, avgDaysInStatus: 4.1 },
  { status: 'validating', count: 12, avgDaysInStatus: 6.8 },
  { status: 'validated', count: 4, avgDaysInStatus: 1.9 },
  { status: 'espelho_generated', count: 7, avgDaysInStatus: 3.2 },
  { status: 'sent_to_fenicia', count: 6, avgDaysInStatus: 11.5 },
  { status: 'li_pending', count: 3, avgDaysInStatus: 18.7 },
];

const slaProc = (idx: number) => PROCESSES[idx % PROCESSES.length];

export const DASHBOARD_SLA = {
  docsOverdue: [4, 5, 8, 11, 14, 17].map((idx, i) => {
    const p = slaProc(idx);
    return {
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      shipmentDate: day(-9 - i * 4),
      daysSinceShipment: 9 + i * 4,
      assignedUser: i % 3 === 2 ? null : ['Eduarda Fiscal e Aduaneira', 'Odett Comex'][i % 2],
    };
  }),
  liUrgent: LI_DEADLINES.slice(0, 5).map((d) => ({
    id: d.processId,
    processCode: d.processCode,
    brand: d.brand,
    liDeadline: d.liDeadline,
    daysRemaining: d.daysRemaining,
    status: findProcess(d.processId)?.status ?? 'li_pending',
  })),
  withDivergences: [2, 6, 10, 15].map((idx, i) => {
    const p = slaProc(idx);
    return {
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      failedCheckCount: [5, 2, 1, 8][i],
      lastValidationDate: iso(-i - 1, 14, 10),
    };
  }),
  pendingFenicia: [4, 13].map((idx, i) => {
    const p = slaProc(idx);
    return {
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      espelhoGeneratedDate: i === 1 ? null : iso(-6),
      daysPending: [6, 2][i],
    };
  }),
  noEspelho: [3, 12, 21].map((idx, i) => {
    const p = slaProc(idx);
    return {
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      validatedDate: iso(-2 - i * 3),
      daysPending: 2 + i * 3,
    };
  }),
  noFollowUpUpdate: [7, 9, 16, 19, 22].map((idx, i) => {
    const p = slaProc(idx);
    return {
      id: p.id,
      processCode: p.processCode,
      brand: p.brand,
      lastUpdateDate: iso(-8 - i * 5),
      daysSinceUpdate: 8 + i * 5,
    };
  }),
  agingByUser: [
    { userName: 'Eduarda Fiscal e Aduaneira', pendingCount: 14, oldestPendingDays: 41 },
    { userName: 'Odett Comex', pendingCount: 6, oldestPendingDays: 19 },
    { userName: 'Nicolas Matsuda Auditoria', pendingCount: 2, oldestPendingDays: 3 },
    { userName: 'Sem responsavel', pendingCount: 9, oldestPendingDays: 67 },
  ],
  upcomingPayments: CURRENCY_EXCHANGES.slice(0, 7).map((e, i) => ({
    id: e.id,
    processId: Number(e.processId),
    processCode: findProcess(Number(e.processId))?.processCode ?? e.processId,
    amountUsd: e.amountUsd.toFixed(2),
    paymentDeadline: day(-2 + i * 3),
    daysUntilDue: -2 + i * 3,
  })),
  summary: {} as Record<string, number>,
};

DASHBOARD_SLA.summary = {
  docsOverdue: DASHBOARD_SLA.docsOverdue.length,
  liUrgent: DASHBOARD_SLA.liUrgent.length,
  withDivergences: DASHBOARD_SLA.withDivergences.length,
  pendingFenicia: DASHBOARD_SLA.pendingFenicia.length,
  noEspelho: DASHBOARD_SLA.noEspelho.length,
  noFollowUpUpdate: DASHBOARD_SLA.noFollowUpUpdate.length,
  agingByUser: DASHBOARD_SLA.agingByUser.length,
  upcomingPayments: DASHBOARD_SLA.upcomingPayments.length,
};

// ── Handlers ─────────────────────────────────────────────────────────────

const PROCESS_DETAIL = /^\/api\/processes\/(\d+)$/;
const EXCHANGE_BY_PROCESS = /^\/api\/currency-exchange\/process\/(\d+)$/;
const EXCHANGE_TOTALS = /^\/api\/currency-exchange\/process\/(\d+)\/totals$/;

function idFrom(url: URL, pattern: RegExp): string {
  return pattern.exec(url.pathname)?.[1] ?? '';
}

export const importacaoCoreHandlers: FixtureHandler[] = [
  // Sessao / saude
  { path: '/api/auth/me', method: 'GET', body: ok(AUDIT_USER) },
  { path: '/api/health', method: 'GET', body: { status: 'ok' } },

  // Processos
  {
    path: '/api/processes',
    method: 'GET',
    body: (url: URL) => paginated(filterProcesses(url), url),
  },
  {
    path: PROCESS_DETAIL,
    method: 'GET',
    body: (url: URL) => {
      const proc = findProcess(Number(idFrom(url, PROCESS_DETAIL)));
      return proc ? ok(proc) : { success: false, error: 'Processo nao encontrado' };
    },
  },

  // Dashboard
  { path: '/api/dashboard/overview', method: 'GET', body: ok(DASHBOARD_OVERVIEW) },
  { path: '/api/dashboard/by-status', method: 'GET', body: ok(DASHBOARD_BY_STATUS) },
  { path: '/api/dashboard/by-month', method: 'GET', body: ok(DASHBOARD_BY_MONTH) },
  { path: '/api/dashboard/fob-by-brand', method: 'GET', body: ok(DASHBOARD_FOB_BY_BRAND) },
  { path: '/api/dashboard/executive', method: 'GET', body: ok(DASHBOARD_EXECUTIVE) },
  {
    path: '/api/dashboard/executive/timeline',
    method: 'GET',
    body: ok(DASHBOARD_EXECUTIVE_TIMELINE),
  },
  { path: '/api/dashboard/sla', method: 'GET', body: ok(DASHBOARD_SLA) },

  // Alertas e e-mails
  { path: '/api/alerts', method: 'GET', body: (url: URL) => paginated(filterAlerts(url), url) },
  {
    path: '/api/email-ingestion/logs',
    method: 'GET',
    body: (url: URL) => paginated(filterEmailLogs(url), url),
  },

  // Follow-up
  { path: '/api/follow-up', method: 'GET', body: (url: URL) => paginated(FOLLOW_UP_ROWS, url) },
  { path: '/api/follow-up/deadlines/li', method: 'GET', body: ok(LI_DEADLINES) },

  // LI tracking
  {
    path: '/api/li-tracking',
    method: 'GET',
    body: (url: URL) => paginated(filterLiItems(url), url, 25),
  },
  {
    path: '/api/li-tracking/stats',
    method: 'GET',
    body: ok({
      byStatus: countBy(LI_ITEMS, (li) => li.status),
      byOrgao: countBy(LI_ITEMS, (li) => li.orgao),
    }),
  },

  // Cambio
  {
    path: '/api/currency-exchange',
    method: 'GET',
    body: (url: URL) => paginated(CURRENCY_EXCHANGES, url),
  },
  {
    path: EXCHANGE_TOTALS,
    method: 'GET',
    body: (url: URL) => ok(exchangeTotals(idFrom(url, EXCHANGE_TOTALS))),
  },
  {
    path: EXCHANGE_BY_PROCESS,
    method: 'GET',
    body: (url: URL) => ok(exchangesForProcess(idFrom(url, EXCHANGE_BY_PROCESS))),
  },
];
