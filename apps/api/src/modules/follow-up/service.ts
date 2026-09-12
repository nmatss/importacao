import { eq, sql, count, and } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { followUpTracking, importProcesses, users } from '../../shared/database/schema.js';
import type { FollowUpTracking } from '../../shared/database/schema.js';
import { googleSheetsService } from '../integrations/google-sheets.service.js';
import { logger } from '../../shared/utils/logger.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { processService } from '../processes/service.js';
import { recordProcessEvent } from '../../shared/utils/process-events.js';
import {
  localDayStartUtc,
  localDayEndExclusiveUtc,
  SQL_HOJE_LOCAL,
} from '../../shared/utils/dates.js';
import {
  ACTIVE_CHECKLIST_STEP_KEYS,
  CHECKLIST_STEP_KEYS,
  checklistStepLabel,
  isActiveChecklistStep,
  isChecklistStep,
  type ChecklistStepKey,
} from '../processes/checklist-catalog.js';
import {
  getChecklistStepAttribution as getStepCompletedByMap,
  type StepCompletedBy,
} from '../processes/checklist-attribution.js';
import { indexRowByHeader } from './sheet-columns.js';
import { diffProcessAgainstRow, getSyncMode, runFollowUpSheetSync } from './sheet-sync.js';

/**
 * Modos aceitos pelo endpoint manual. 'conservative' e 'industrial' sao os
 * nomes antigos: o primeiro vira simulacao, o segundo e recusado.
 */
export type FollowUpSyncRequestMode = 'dry_run' | 'apply' | 'conservative' | 'industrial';

/**
 * O CATALOGO do checklist saiu deste arquivo (decisao D7, reuniao 11/09).
 *
 * Passos, rotulos e quais estao ativos vivem em
 * `processes/checklist-catalog.ts` e sao servidos por
 * `GET /api/processes/:id/checklist`. Aqui ficou so o que e desta camada:
 * gravar em `follow_up_tracking` e registrar o evento de historico. Antes a
 * lista existia aqui E na web, e os rotulos divergiam — clicar em "Atualizar
 * Follow-up" gravava "Checklist: Enviado para Fenicia feito".
 */
const TRACKING_STEPS = CHECKLIST_STEP_KEYS;

function calculateProgress(tracking: Partial<FollowUpTracking>): number {
  const completedSteps = ACTIVE_CHECKLIST_STEP_KEYS.reduce(
    (total, step) => total + (tracking[step] ? 1 : 0),
    0,
  );

  // Do not use an integer weight per stage: 15 * floor(100 / 15) capped a
  // fully completed follow-up at 90%. The displayed progress is a business
  // completion indicator, so every persisted milestone must be able to reach
  // exactly 100%.
  //
  // O denominador conta so as etapas ATIVAS: "Coletar Assinaturas" e "Enviar
  // Docs Assinados" sairam da rotina (D7) e, contadas, travariam em 87% um
  // processo com tudo feito.
  return Math.round((completedSteps / ACTIVE_CHECKLIST_STEP_KEYS.length) * 100);
}

async function recordChecklistEvent(
  processId: number,
  step: ChecklistStepKey,
  previousStatus: 'pendente' | 'feito',
  newStatus: 'pendente' | 'feito',
  completedAt: Date | null,
  userId: number | null,
  userName: string | null,
) {
  if (previousStatus === newStatus) return;

  // Mesmo rotulo da tela: fonte unica no catalogo.
  const label = checklistStepLabel(step);
  await recordProcessEvent(
    processId,
    {
      eventType: 'checklist_step_changed',
      title: `Checklist: ${label} ${newStatus}`,
      description: `${label}: ${previousStatus} -> ${newStatus}`,
      metadata: {
        step,
        item: label,
        previousStatus,
        newStatus,
        completedAt: completedAt?.toISOString() ?? null,
        // Persist who acted so the checklist can show "Concluido por <nome>".
        // Stored in the event metadata (no schema migration on follow_up_tracking).
        completedBy: userId,
        completedByName: userName,
      },
    },
    userId,
  );
}

/**
 * Resolves the display name of the acting user for checklist attribution.
 * The JWT payload only carries id/email/role, so we look up the name.
 */
async function resolveUserName(userId: number | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * A leitura de "quem concluiu cada etapa" mudou de arquivo para
 * `processes/checklist-attribution.ts`: a aba Follow-Up (aqui) e a aba
 * Checklist (`GET /api/processes/:id/checklist`) precisam da MESMA leitura, e
 * o modulo de processos nao pode importar este service sem ciclo.
 */
export type { StepCompletedBy };

export const followUpService = {
  async getAll(page = 1, limit = 20, startDate?: string, endDate?: string) {
    const offset = (page - 1) * limit;
    const conditions = [];

    // O dia escolhido no calendario local vira o intervalo UTC equivalente.
    const start = startDate ? localDayStartUtc(startDate) : null;
    if (start) {
      conditions.push(sql`${followUpTracking.updatedAt} >= ${start.toISOString()}`);
    }
    // Limite superior EXCLUSIVO: inicio do dia local seguinte, em UTC.
    const end = endDate ? localDayEndExclusiveUtc(endDate) : null;
    if (end) {
      conditions.push(sql`${followUpTracking.updatedAt} < ${end.toISOString()}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: followUpTracking.id,
          processId: followUpTracking.processId,
          processCode: importProcesses.processCode,
          brand: importProcesses.brand,
          status: importProcesses.status,
          documentsReceivedAt: followUpTracking.documentsReceivedAt,
          preInspectionAt: followUpTracking.preInspectionAt,
          ncmVerifiedAt: followUpTracking.ncmVerifiedAt,
          espelhoGeneratedAt: followUpTracking.espelhoGeneratedAt,
          sentToFeniciaAt: followUpTracking.sentToFeniciaAt,
          liSubmittedAt: followUpTracking.liSubmittedAt,
          liApprovedAt: followUpTracking.liApprovedAt,
          liDeadline: followUpTracking.liDeadline,
          overallProgress: followUpTracking.overallProgress,
          notes: followUpTracking.notes,
          createdAt: followUpTracking.createdAt,
          updatedAt: followUpTracking.updatedAt,
        })
        .from(followUpTracking)
        .innerJoin(importProcesses, eq(followUpTracking.processId, importProcesses.id))
        .where(where)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(followUpTracking).where(where),
    ]);

    return { data, total, page, limit };
  },

  async getByProcess(processId: number) {
    const [tracking] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    if (!tracking) throw new NotFoundError('Acompanhamento não encontrado');

    // Enrich with per-step attribution ("Concluido por <nome>") derived from the
    // latest checklist_step_changed event for each step. No schema migration needed.
    const stepCompletedBy = await getStepCompletedByMap(processId);
    if (Object.keys(stepCompletedBy).length > 0) {
      return { ...tracking, stepCompletedBy };
    }
    return tracking;
  },

  async update(processId: number, data: Record<string, any>) {
    const ALLOWED_FIELDS = [
      'documentsReceivedAt',
      'preInspectionAt',
      'ncmVerifiedAt',
      'espelhoGeneratedAt',
      'sentToFeniciaAt',
      'liSubmittedAt',
      'liApprovedAt',
      'liDeadline',
      'notes',
    ] as const;
    const safeData: Record<string, any> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in data) safeData[field] = data[field];
    }

    // Merge existing tracking data with incoming changes to calculate correct progress
    const [existing] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const merged = { ...(existing ?? {}), ...safeData };
    const overallProgress = calculateProgress(merged);

    const [tracking] = await db
      .update(followUpTracking)
      .set({
        ...safeData,
        overallProgress,
        updatedAt: new Date(),
      })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    if (!tracking) throw new NotFoundError('Acompanhamento não encontrado');

    processService
      .advanceLogisticStatus(processId)
      .catch((err) =>
        logger.error({ err, processId }, 'advanceLogisticStatus failed after follow-up update'),
      );

    return tracking;
  },

  async updateStep(
    processId: number,
    step: string,
    completedAt: Date | null,
    userId: number | null = null,
  ) {
    // Quem decide o que e passo valido e o catalogo (D7). Chave fora do
    // catalogo e erro de cliente; chave INATIVA ("Coletar Assinaturas",
    // "Enviar Docs Assinados") saiu da rotina e nao pode voltar a ser marcada
    // por uma tela antiga — os timestamps ja gravados continuam no banco.
    if (!isChecklistStep(step)) {
      throw new Error(`Passo invalido: ${step}. Passos validos: ${TRACKING_STEPS.join(', ')}`);
    }
    if (!isActiveChecklistStep(step)) {
      throw new Error(
        `A etapa "${checklistStepLabel(step)}" saiu do checklist e nao pode mais ser marcada.`,
      );
    }
    const typedStep: ChecklistStepKey = step;

    // Check if tracking exists, create if not
    const [existing] = await db
      .select()
      .from(followUpTracking)
      .where(eq(followUpTracking.processId, processId))
      .limit(1);

    const previousStatus = existing?.[typedStep] ? 'feito' : 'pendente';
    const newStatus = completedAt ? 'feito' : 'pendente';
    const userName = await resolveUserName(userId);

    if (!existing) {
      const [created] = await db
        .insert(followUpTracking)
        .values({ processId, [step]: completedAt })
        .returning();
      const progress = calculateProgress(created);
      const [updated] = await db
        .update(followUpTracking)
        .set({ overallProgress: progress })
        .where(eq(followUpTracking.processId, processId))
        .returning();
      await recordChecklistEvent(
        processId,
        typedStep,
        previousStatus,
        newStatus,
        completedAt,
        userId,
        userName,
      );
      const stepCompletedBy = await getStepCompletedByMap(processId);
      return Object.keys(stepCompletedBy).length > 0 ? { ...updated, stepCompletedBy } : updated;
    }

    const [updated] = await db
      .update(followUpTracking)
      .set({ [step]: completedAt, updatedAt: new Date() })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    const progress = calculateProgress(updated);
    const [final] = await db
      .update(followUpTracking)
      .set({ overallProgress: progress })
      .where(eq(followUpTracking.processId, processId))
      .returning();

    processService
      .advanceLogisticStatus(processId)
      .catch((err) =>
        logger.error({ err, processId }, 'advanceLogisticStatus failed after follow-up updateStep'),
      );

    await recordChecklistEvent(
      processId,
      typedStep,
      previousStatus,
      newStatus,
      completedAt,
      userId,
      userName,
    );

    const stepCompletedBy = await getStepCompletedByMap(processId);
    return Object.keys(stepCompletedBy).length > 0 ? { ...final, stepCompletedBy } : final;
  },

  /**
   * Diferencas entre a linha da planilha e o processo, SEM gravar nada.
   *
   * A versao anterior procurava cabecalhos que nao existem na planilha ('FOB',
   * 'Frete', 'ETD', 'Fornecedor' — os reais sao 'Valor Invoice (USD)', 'Frete
   * (USD)', 'ETD ORIGEM*', 'Fornecedor/ Supplier'), lia so ate a coluna Z (as
   * datas de ETA e de registro ficam depois disso) e fazia
   * `parseFloat('101.346,01'.replace(',', '.'))`, que da **101.346** — mil
   * vezes menos que o valor real. O mapeamento e o parse agora sao os mesmos da
   * sync agendada (`sheet-columns.ts`), testados contra os valores da planilha.
   */
  async compareWithSheet(processCode: string) {
    const sheetData = await googleSheetsService.readProcessRow(processCode);
    if (!sheetData) {
      throw new Error('Processo nao encontrado na planilha Follow-Up');
    }

    // Find the process in DB
    const [process] = await db
      .select()
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode));

    if (!process) {
      throw new Error('Processo nao encontrado no sistema');
    }

    const row = indexRowByHeader(Object.keys(sheetData), Object.values(sheetData));
    const comparison = diffProcessAgainstRow(process, row);

    return {
      processCode,
      sheetStatus: comparison.sheetStatus,
      sheetData,
      differences: comparison.changes,
      unavailable: comparison.unavailable,
      hasDifferences: comparison.changes.length > 0,
    };
  },

  /**
   * Aplica a planilha a UM processo. Respeita `FOLLOW_UP_SYNC_MODE`.
   *
   * O modo 'industrial' saiu: ele gravava a string crua '07/08/2026' numa
   * coluna `date` e o FOB dividido por mil, a um clique de distancia de
   * qualquer admin. Quem quiser gravar passa `mode: 'apply'` COM
   * `FOLLOW_UP_SYNC_MODE=apply` configurado — duas chaves, nao uma.
   */
  async syncFromSheet(processCode: string, mode: FollowUpSyncRequestMode = 'dry_run') {
    if (mode === 'industrial') {
      throw new Error(
        'O modo "industrial" foi removido: ele gravava data e valor sem parse (FOB mil vezes menor). Use mode "apply" com FOLLOW_UP_SYNC_MODE=apply.',
      );
    }

    const configured = getSyncMode();
    if (mode === 'apply' && configured !== 'apply') {
      throw new Error(
        `Gravacao bloqueada: FOLLOW_UP_SYNC_MODE=${configured}. Configure "apply" para a sincronizacao poder escrever no banco.`,
      );
    }

    const effectiveMode = mode === 'apply' ? 'apply' : 'dry_run';
    const result = await runFollowUpSheetSync({
      mode: effectiveMode,
      processCodes: [processCode],
      includeTerminal: true,
    });

    const item = result.processes.find(
      (entry) => entry.processCode.toUpperCase() === processCode.trim().toUpperCase(),
    );

    if (!item) {
      throw new Error(
        'Processo nao encontrado na planilha Follow-Up, ou esta travado para alteracoes',
      );
    }

    return {
      updated: effectiveMode === 'apply' && item.changes.length > 0,
      mode: effectiveMode,
      message:
        item.changes.length === 0
          ? 'Nenhuma diferenca encontrada'
          : effectiveMode === 'apply'
            ? `${item.changes.length} campo(s) atualizado(s)`
            : `${item.changes.length} campo(s) divergente(s); nada foi gravado (simulacao)`,
      differences: item.changes,
      unavailable: item.unavailable,
      updatedFields: effectiveMode === 'apply' ? item.changes.map((change) => change.field) : [],
      diff: result.diff,
    };
  },

  async getLiDeadlines() {
    const results = await db
      .select({
        processId: importProcesses.id,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
        status: importProcesses.status,
        shipmentDate: importProcesses.shipmentDate,
        liDeadline: sql<string>`${importProcesses.shipmentDate}::date + 13`,
        // `CURRENT_DATE` e o dia em UTC; das 21h a meia-noite no Brasil ele ja
        // virou, e o "dias restantes" da tela de prazos de LI mostrava um dia a
        // menos.
        daysRemaining: sql<number>`${importProcesses.shipmentDate}::date + 13 - ${sql.raw(SQL_HOJE_LOCAL)}`,
        liSubmittedAt: followUpTracking.liSubmittedAt,
        liApprovedAt: followUpTracking.liApprovedAt,
      })
      .from(importProcesses)
      .innerJoin(followUpTracking, eq(followUpTracking.processId, importProcesses.id))
      .where(
        and(eq(importProcesses.hasLiItems, true), sql`${importProcesses.shipmentDate} IS NOT NULL`),
      );

    return results;
  },
};
