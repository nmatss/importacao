import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses, auditLogs, processEvents } from '../../shared/database/schema.js';
import { googleSheetsService } from '../integrations/google-sheets.service.js';
import { logger } from '../../shared/utils/logger.js';
import { getEnv } from '../../shared/config/env.js';
import {
  PROCESS_CODE_HEADERS,
  SHEET_STATUS_HEADERS,
  SYNCABLE_FIELDS,
  findMissingColumns,
  formatForDiff,
  indexRowByHeader,
  isSameAsCurrent,
  readField,
  readRowText,
  toColumnValue,
  type SheetRow,
  type SyncableField,
} from './sheet-columns.js';

/**
 * Sincronizacao Follow Up -> `import_processes` (decisao D4, reuniao 11/09).
 *
 * Por que ela existe: a referencia do sistema era um SNAPSHOT de 25/08, feito
 * a mao por `scripts/import-follow-up.js` a partir de um xlsx baixado. Desde
 * entao a planilha andou e o banco nao: o PK2202608SZ mostrava FOB
 * 101.265,19 com a planilha em 101.346,01, o PK2192607SZ mostrava atracacao
 * 17/09 com as tres datas reais em 08/09, e o numero da DUIMP registrada em
 * 04/09 nunca chegou a coluna que a tela le.
 *
 * Limites deliberados:
 * - **Leitura da planilha, escrita SO no nosso banco.** Nenhuma celula da
 *   Follow Up e tocada. A restricao do usuario ("as colunas e dados das fontes
 *   nao devem ser alterados") vale inclusive para a correcao.
 * - **`FOLLOW_UP_SYNC_MODE` manda**: `off` nao le nada, `dry_run` (padrao)
 *   calcula o diff e NAO grava, `apply` grava.
 * - **Indisponivel nunca apaga.** Celula vazia, `#ERROR!` ou texto livre
 *   ("EM TEMPO" na data de registro) mantem o valor que ja estava no banco e
 *   entra no relatorio como indisponivel, com motivo.
 * - **Processo travado nao e tocado**, igual ao resto do sistema (lock Vimbar).
 */

export type FollowUpSyncMode = 'off' | 'dry_run' | 'apply';

export interface SheetSyncChange {
  field: SyncableField;
  column: string | null;
  from: string;
  to: string;
}

export interface SheetSyncUnavailable {
  field: SyncableField;
  column: string | null;
  reason: string;
}

export interface SheetSyncProcess {
  processId: number;
  processCode: string;
  /** Status da coluna B da planilha, quando existe. */
  sheetStatus: string | null;
  /** `true` quando esse status mudou em relacao ao que estava guardado aqui. */
  sheetStatusChanged: boolean;
  changes: SheetSyncChange[];
  unavailable: SheetSyncUnavailable[];
}

export interface SheetSyncResult {
  mode: FollowUpSyncMode;
  /** `true` somente quando o modo era `apply` e houve gravacao. */
  applied: boolean;
  scannedRows: number;
  matchedProcesses: number;
  changedProcesses: number;
  totalChanges: number;
  processes: SheetSyncProcess[];
  /** Codigos que aparecem na planilha e nao existem como processo aqui. */
  unknownCodes: string[];
  /** Codigos repetidos na planilha. Conflitos são excluídos da aplicação. */
  duplicatedCodes: string[];
  conflictingCodes: string[];
  concurrentCodes: string[];
  /** Campos cuja coluna sumiu do cabecalho da planilha. */
  missingColumns: SyncableField[];
  /** Diff legivel, uma linha por campo alterado. */
  diff: string;
}

const TERMINAL_STATUSES = ['completed', 'cancelled'] as const;

/** Ultimo diff registrado no log, para nao repetir o mesmo texto a cada meia hora. */
let ultimaAssinaturaDeDiff = '';

export function getSyncMode(): FollowUpSyncMode {
  return getEnv().FOLLOW_UP_SYNC_MODE;
}

/**
 * O que a comparacao precisa de um processo: as colunas que a planilha alimenta
 * mais a identificacao e o jsonb onde mora o status da planilha. Tipar so isso
 * (em vez da linha inteira) deixa o teste montar uma fixture REAL, conferida
 * pelo compilador, sem `as`.
 */
export type SyncableProcess = Pick<
  typeof importProcesses.$inferSelect,
  'id' | 'processCode' | 'aiExtractedData' | SyncableField
>;

function upper(code: string): string {
  return code.trim().toUpperCase();
}

/** Monta o indice codigo -> linha da planilha, avisando sobre repetidos. */
export function indexSheetRows(headers: unknown[], rows: unknown[][]) {
  const byCode = new Map<string, SheetRow>();
  const duplicated: string[] = [];
  const conflicting = new Set<string>();

  for (const values of rows) {
    const row = indexRowByHeader(headers, values);
    const code = upper(readRowText(row, PROCESS_CODE_HEADERS));
    if (!code) continue;
    if (conflicting.has(code)) continue;
    if (byCode.has(code)) {
      if (!duplicated.includes(code)) duplicated.push(code);
      if (JSON.stringify(byCode.get(code)) !== JSON.stringify(row)) {
        conflicting.add(code);
        byCode.delete(code);
      }
      continue;
    }
    byCode.set(code, row);
  }

  return { byCode, duplicated, conflicting: [...conflicting] };
}

/** Compara uma linha da planilha com o processo, sem tocar no banco. */
export function diffProcessAgainstRow(process: SyncableProcess, row: SheetRow): SheetSyncProcess {
  const changes: SheetSyncChange[] = [];
  const unavailable: SheetSyncUnavailable[] = [];

  for (const field of SYNCABLE_FIELDS) {
    const { column, reading } = readField(row, field);
    if (!reading.available) {
      // Celula vazia e coluna ausente nao viram aviso POR PROCESSO: a primeira e
      // o estado normal de um processo que ainda nao andou, e a segunda ja e
      // relatada uma vez so, no cabecalho (`missingColumns`). O que sobra aqui e
      // o que merece o olho do operador: formula quebrada e texto livre onde
      // deveria haver data ou numero.
      if (column !== null && reading.raw !== '' && !reading.expected) {
        unavailable.push({ field, column, reason: reading.reason });
      }
      continue;
    }
    const current = process[field];
    if (isSameAsCurrent(field, reading.value, current)) continue;
    changes.push({
      field,
      column,
      from: formatForDiff(field, current),
      to: formatForDiff(field, toColumnValue(field, reading.value)),
    });
  }

  // A coluna B ('Status') e a leitura que a equipe faz do processo ("Em
  // transito para Itapoa", "Aguardando Entrada"). Ela nao vira coluna do banco:
  // fica em `ai_extracted_data.sheetStatus`, onde o importador ja a guardava, e
  // de la alimenta a derivacao do estagio logistico (FUP-05).
  const sheetStatus = readRowText(row, SHEET_STATUS_HEADERS) || null;
  const storedStatus = readStoredSheetStatus(process.aiExtractedData);

  return {
    processId: process.id,
    processCode: process.processCode,
    sheetStatus,
    sheetStatusChanged: sheetStatus !== null && sheetStatus !== storedStatus,
    changes,
    unavailable,
  };
}

/** `ai_extracted_data.sheetStatus` ja guardado no processo. */
export function readStoredSheetStatus(aiExtractedData: unknown): string | null {
  if (!aiExtractedData || typeof aiExtractedData !== 'object' || Array.isArray(aiExtractedData)) {
    return null;
  }
  const value = (aiExtractedData as Record<string, unknown>).sheetStatus;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function buildPatch(row: SheetRow, changes: SheetSyncChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const change of changes) {
    const { reading } = readField(row, change.field);
    if (!reading.available) continue;
    patch[change.field] = toColumnValue(change.field, reading.value);
  }
  return patch;
}

/**
 * Diff legivel: uma linha por campo, com a coluna de origem entre parenteses.
 *
 * O teto de processos existe porque a primeira leitura em producao encontra
 * diferenca em quase todos (o banco esta parado desde 25/08): sem ele, uma
 * unica linha de log teria dezenas de milhares de caracteres e ninguem a leria.
 */
const MAX_PROCESSOS_NO_DIFF = 50;

export function renderDiff(processes: SheetSyncProcess[], mode: FollowUpSyncMode): string {
  const comMudanca = processes.filter((item) => item.changes.length > 0);
  const lines: string[] = [];
  for (const item of comMudanca.slice(0, MAX_PROCESSOS_NO_DIFF)) {
    lines.push(`${item.processCode}:`);
    for (const change of item.changes) {
      lines.push(`  ${change.field}: ${change.from} -> ${change.to} (${change.column ?? '?'})`);
    }
  }
  const restantes = comMudanca.length - MAX_PROCESSOS_NO_DIFF;
  if (restantes > 0) lines.push(`... e mais ${restantes} processo(s) com diferenca.`);
  if (lines.length === 0) return 'Nenhuma diferenca entre a planilha e o banco.';
  const cabecalho =
    mode === 'apply'
      ? 'Follow Up -> banco (GRAVADO):'
      : 'Follow Up -> banco (simulacao, nada foi gravado):';
  return [cabecalho, ...lines].join('\n');
}

export interface SheetSyncOptions {
  /** Sobrescreve `FOLLOW_UP_SYNC_MODE` (usado pelo endpoint manual e por teste). */
  mode?: FollowUpSyncMode;
  /** Limita a sync a estes codigos de processo. */
  processCodes?: string[];
  /** Inclui encerrados/cancelados (padrao: so processos ativos). */
  includeTerminal?: boolean;
  userId?: number | null;
}

/**
 * Le a planilha e atualiza (ou simula) os campos de referencia do processo.
 *
 * Lanca quando a planilha nao pode ser lida: "a planilha nao tem processos" e
 * "nao consegui falar com o Sheets" nao podem virar a mesma resposta vazia —
 * foi assim que uma queda de 12 dias passou sem ninguem ver (08/2026).
 */
export async function runFollowUpSheetSync(
  options: SheetSyncOptions = {},
): Promise<SheetSyncResult> {
  const mode = options.mode ?? getSyncMode();
  const empty: SheetSyncResult = {
    mode,
    applied: false,
    scannedRows: 0,
    matchedProcesses: 0,
    changedProcesses: 0,
    totalChanges: 0,
    processes: [],
    unknownCodes: [],
    duplicatedCodes: [],
    conflictingCodes: [],
    concurrentCodes: [],
    missingColumns: [],
    diff: 'FOLLOW_UP_SYNC_MODE=off: a sincronizacao da planilha esta desligada.',
  };

  if (mode === 'off') {
    logger.info('follow-up sheet sync desligada (FOLLOW_UP_SYNC_MODE=off)');
    return empty;
  }

  const { headers, rows } = await googleSheetsService.readProcessSheetMatrix();
  const { byCode, duplicated, conflicting } = indexSheetRows(headers, rows);
  const missingColumns = findMissingColumns(headers);
  if (missingColumns.length > 0) {
    logger.warn(
      { missingColumns },
      'follow-up sheet sync: colunas esperadas ausentes no cabecalho da planilha',
    );
  }

  const codeFilter = options.processCodes?.map(upper) ?? null;
  const conditions = [isNull(importProcesses.lockedAt)];
  if (!options.includeTerminal) {
    conditions.push(notInArray(importProcesses.status, [...TERMINAL_STATUSES]));
  }
  if (codeFilter && codeFilter.length > 0) {
    conditions.push(inArray(importProcesses.processCode, codeFilter));
  }

  const processes = await db
    .select()
    .from(importProcesses)
    .where(and(...conditions));

  const results: SheetSyncProcess[] = [];
  let changedProcesses = 0;
  let totalChanges = 0;
  let matched = 0;
  let appliedProcesses = 0;
  const concurrentCodes: string[] = [];

  for (const process of processes) {
    const row = byCode.get(upper(process.processCode));
    if (!row) continue;
    matched += 1;

    const item = diffProcessAgainstRow(process, row);
    results.push(item);
    if (item.changes.length === 0 && !item.sheetStatusChanged) continue;

    if (item.changes.length > 0) {
      changedProcesses += 1;
      totalChanges += item.changes.length;
    }

    if (mode !== 'apply') continue;

    const patch = buildPatch(row, item.changes);
    if (item.sheetStatusChanged && item.sheetStatus) {
      // Merge no jsonb: nunca substituir o objeto inteiro, que carrega a
      // extracao da IA do processo.
      patch.aiExtractedData = sql`COALESCE(${importProcesses.aiExtractedData}, '{}'::jsonb) || ${JSON.stringify(
        { sheetStatus: item.sheetStatus, sheetStatusSyncedAt: new Date().toISOString() },
      )}::jsonb`;
    }
    if (Object.keys(patch).length === 0) continue;

    const changedFields: string[] = item.changes.map((change) => change.field);
    if (item.sheetStatusChanged) changedFields.push('sheetStatus');
    const applied = await db.transaction(async (tx) => {
      const guards = [
        eq(importProcesses.id, process.id),
        isNull(importProcesses.lockedAt),
        process.updatedAt
          ? eq(importProcesses.updatedAt, process.updatedAt)
          : isNull(importProcesses.updatedAt),
      ];
      if (!options.includeTerminal)
        guards.push(notInArray(importProcesses.status, [...TERMINAL_STATUSES]));
      const updated = await tx
        .update(importProcesses)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(...guards))
        .returning({ id: importProcesses.id });
      if (updated.length === 0) return false;
      // These records are part of the mutation, not optional telemetry. Failure
      // rolls back the process update instead of silently losing provenance.
      await tx.insert(auditLogs).values({
        userId: options.userId ?? null,
        action: 'follow_up_sheet_sync',
        entityType: 'process',
        entityId: process.id,
        details: {
          fields: changedFields,
          changes: item.changes,
          ...(item.sheetStatusChanged
            ? {
                sheetStatus: {
                  from: readStoredSheetStatus(process.aiExtractedData),
                  to: item.sheetStatus,
                },
              }
            : {}),
        },
        ipAddress: null,
      });
      await tx.insert(processEvents).values({
        processId: process.id,
        eventType: 'follow_up_sheet_synced',
        title: `Follow Up atualizou ${changedFields.length} campo(s) do processo`,
        description: item.changes
          .map((change) => `${change.field}: ${change.from} -> ${change.to}`)
          .join(' | '),
        metadata: {
          source: 'follow_up_sheet',
          changes: item.changes,
          ...(item.sheetStatusChanged
            ? {
                sheetStatus: {
                  from: readStoredSheetStatus(process.aiExtractedData),
                  to: item.sheetStatus,
                },
              }
            : {}),
        },
        createdBy: options.userId ?? null,
      });
      return true;
    });
    if (!applied) {
      concurrentCodes.push(process.processCode);
      results.pop();
      if (item.changes.length > 0) {
        changedProcesses -= 1;
        totalChanges -= item.changes.length;
      }
      continue;
    }
    appliedProcesses += 1;
  }

  // Os codigos conhecidos vem da tabela INTEIRA, e nao da selecao filtrada:
  // senao todo processo encerrado da planilha apareceria como "desconhecido".
  const allProcessCodes = await db
    .select({ processCode: importProcesses.processCode })
    .from(importProcesses);
  const knownCodes = new Set(allProcessCodes.map((row) => upper(row.processCode)));
  const unknownCodes = (codeFilter ?? [...byCode.keys()]).filter((code) => !knownCodes.has(code));

  const result: SheetSyncResult = {
    mode,
    applied: mode === 'apply' && appliedProcesses > 0,
    scannedRows: byCode.size,
    matchedProcesses: matched,
    changedProcesses,
    totalChanges,
    processes: results,
    unknownCodes,
    duplicatedCodes: duplicated,
    conflictingCodes: conflicting,
    concurrentCodes,
    missingColumns,
    diff: renderDiff(results, mode),
  };

  // O dry-run roda a cada 30 minutos e, como nao grava, produziria o MESMO
  // diff para sempre. Repetir isso no log so esconde o que mudou de verdade.
  const assinatura = `${mode}:${result.diff}`;
  const diffNovo = assinatura !== ultimaAssinaturaDeDiff;
  ultimaAssinaturaDeDiff = assinatura;

  logger.info(
    {
      mode,
      scannedRows: result.scannedRows,
      matchedProcesses: matched,
      changedProcesses,
      totalChanges,
      duplicatedCodes: duplicated.length,
    },
    mode === 'apply' ? 'follow-up sheet sync aplicada' : 'follow-up sheet sync (dry-run)',
  );
  if (totalChanges > 0 && diffNovo) {
    logger.info({ diff: result.diff }, 'follow-up sheet sync diff');
  }

  return result;
}
