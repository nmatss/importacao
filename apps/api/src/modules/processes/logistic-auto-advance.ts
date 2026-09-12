import { VALID_LOGISTIC_STATUSES } from './schema.js';

type LogisticStatus = (typeof VALID_LOGISTIC_STATUSES)[number];

const ORDER: Record<LogisticStatus, number> = VALID_LOGISTIC_STATUSES.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<LogisticStatus, number>,
);

interface DeriveInput {
  process: {
    etd: Date | string | null;
    eta: Date | string | null;
    etaActual?: Date | string | null;
    shipmentDate: Date | string | null;
    customsChannel: string | null;
    diNumber: string | null;
    duimpNumber?: string | null;
    registeredAt?: Date | string | null;
    customsClearanceAt: Date | null;
    cdArrivalAt: Date | null;
    logisticStatus: string | null;
    status: string;
    /** Coluna B da planilha Follow Up ('Aguardando Entrada', 'Em transito...'). */
    sheetStatus?: string | null;
    /** Quando esse status foi lido da planilha (ISO). Ver `logisticStatusFromSheet`. */
    sheetStatusSyncedAt?: string | null;
  };
  followUp: {
    espelhoBuiltAt: Date | null;
    espelhoGeneratedAt: Date | null;
    sentToFeniciaAt: Date | null;
    invoiceSentFeniciaAt: Date | null;
    documentsReceivedAt: Date | null;
  } | null;
  now?: Date;
}

/**
 * Dicionario da coluna 'Status' da planilha -> estagio do ciclo de transporte.
 *
 * A planilha e preenchida pela equipe e e a leitura mais atual do que
 * realmente aconteceu com a carga. Quando ela fala, ela manda: a derivacao por
 * datas e um palpite, e um palpite feito sobre PREVISAO ja colocou o
 * IM0762607NB em "Ag. Entrada" com a planilha dizendo "Em transito para
 * Itapoa" e a chegada no CD prevista para 15/10.
 *
 * A comparacao e por trecho, e nao exata, porque a coluna tem variacao livre
 * ("Em transito para Itapoa", "Em trânsito"). A ordem importa: o primeiro
 * trecho que casar vence, entao os mais especificos vem antes.
 */
const SHEET_STATUS_DICTIONARY: Array<[string, LogisticStatus]> = [
  ['ENCERRADO', 'internalized'],
  ['INTERNALIZAD', 'internalized'],
  ['ENTRADA NF', 'internalized'],
  ['AGUARDANDO ENTRADA', 'waiting_entry'],
  ['AG. ENTRADA', 'waiting_entry'],
  ['VIAGEM CD', 'traveling_cd'],
  ['CARREGAMENTO', 'waiting_loading'],
  ['LIBERAC', 'port_release'],
  ['DESEMBARAC', 'port_release'],
  ['CONFERENCIA ADUANEIRA', 'customs_inspection'],
  ['CANAL', 'customs_inspection'],
  ['REGISTRAD', 'registered'],
  ['ATRACA', 'berthing'],
  ['TRANSITO', 'in_transit'],
  ['TRANSBORDO', 'in_transit'],
  ['EMBARCAD', 'in_transit'],
  ['AGUARDANDO EMBARQUE', 'waiting_shipment'],
  ['AG. EMBARQUE', 'waiting_shipment'],
  ['CONSOLIDA', 'consolidation'],
];

function normalizeSheetStatus(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toUpperCase();
}

/**
 * Estagio declarado pela planilha, ou `null` quando o texto nao e conhecido.
 *
 * `syncedAt` e obrigatorio de proposito: `ai_extracted_data.sheetStatus` tambem
 * existe nos processos que vieram da importacao manual de 25/08, e aquele texto
 * e um retrato congelado — mandar nele seria trocar uma previsao errada por uma
 * leitura velha. So o status trazido pela sincronizacao recorrente
 * (`sheet-sync.ts`, que grava `sheetStatusSyncedAt` junto) e autoritativo.
 */
export function logisticStatusFromSheet(
  sheetStatus: string | null | undefined,
  syncedAt?: string | null,
): LogisticStatus | null {
  if (!sheetStatus || !syncedAt) return null;
  const normalized = normalizeSheetStatus(sheetStatus);
  if (!normalized) return null;
  for (const [needle, status] of SHEET_STATUS_DICTIONARY) {
    if (normalized.includes(needle)) return status;
  }
  return null;
}

/**
 * Estagio do ciclo de transporte a partir do que JA ACONTECEU.
 *
 * Regra que mudou em 11/09: data PREVISTA nao e evento realizado. A versao
 * anterior fazia `if (p.cdArrivalAt) return 'waiting_entry'` — e `cd_arrival_at`
 * vem da coluna 'Chegada CD', que e previsao enquanto a carga nao chega. Bastava
 * a planilha ter uma data futura ali para o processo aparecer como "Ag. Entrada"
 * no mesmo minuto em que foi importado (evento do PK2202608SZ, 25/08 17:30).
 * Agora toda data de marco so conta quando ja passou.
 */
export function deriveLogisticStatus(input: DeriveInput): LogisticStatus {
  const { process: p, followUp: f } = input;
  const now = input.now ?? new Date();

  // 11 — internalized (terminal)
  if (p.status === 'completed') return 'internalized';

  const fromSheet = logisticStatusFromSheet(p.sheetStatus, p.sheetStatusSyncedAt);
  if (fromSheet) return fromSheet;

  const jaAconteceu = (value: Date | string | null | undefined): boolean => {
    const date = toDate(value);
    return date !== null && date.getTime() <= now.getTime();
  };

  // 10 — waiting_entry: chegou no CD (data de chegada ja passou)
  if (jaAconteceu(p.cdArrivalAt)) return 'waiting_entry';

  // 7 — port_release: desembaracado
  if (jaAconteceu(p.customsClearanceAt)) return 'port_release';

  // 6 — customs_inspection: canal parametrizado
  if (p.customsChannel) return 'customs_inspection';

  // 5 — registered: DI/DUIMP registrada
  if (p.diNumber || p.duimpNumber || jaAconteceu(p.registeredAt)) return 'registered';

  // 4 — berthing: atracou (ETA Realizado) ou a ETA firme ja passou
  if (jaAconteceu(p.etaActual) || jaAconteceu(p.eta)) return 'berthing';

  // 3 — in_transit: embarcou
  if (jaAconteceu(p.etd) || jaAconteceu(p.shipmentDate)) return 'in_transit';

  // 2 — waiting_shipment: espelho montado / invoice enviada a Fenicia.
  //
  // `sentToFeniciaAt` saiu daqui: apesar do nome, essa coluna e "Atualizar
  // Follow-up" (CJ da planilha; `updateFollowUp: 87` em import-follow-up.js), e
  // nao o envio a Fenicia, que e `invoiceSentFeniciaAt` (CG). Marcar o checklist
  // "Atualizar Follow-up" empurrava o processo para "Ag. Embarque" sem que nada
  // tivesse sido enviado.
  if (f?.espelhoBuiltAt || f?.espelhoGeneratedAt || f?.invoiceSentFeniciaAt) {
    return 'waiting_shipment';
  }

  // 1 — consolidation (default)
  return 'consolidation';
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function isForwardTransition(current: string | null, next: LogisticStatus): boolean {
  if (!current) return true;
  const cur = ORDER[current as LogisticStatus];
  if (cur === undefined) return true;
  return ORDER[next] > cur;
}

/**
 * Aplicar o estagio derivado por cima do atual?
 *
 * Para frente, sempre. Para TRAS, so quando o estagio atual foi derivado pelo
 * proprio sistema: um estagio derivado de previsao que nao se cumpriu tem que
 * poder ser corrigido, senao o erro fica preso para sempre (o
 * `isForwardTransition` sozinho garantia exatamente isso). O que uma pessoa
 * escolheu a mao continua intocado — quem corrige um override manual e outra
 * pessoa.
 */
export function shouldApplyDerivedStatus(params: {
  current: string | null;
  derived: LogisticStatus;
  manualOverride: boolean;
}): boolean {
  const { current, derived, manualOverride } = params;
  if (!current) return true;
  if (current === derived) return false;
  if (isForwardTransition(current, derived)) return true;
  return !manualOverride;
}
