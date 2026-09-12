import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { processEvents, users } from '../../shared/database/schema.js';

export interface StepCompletedBy {
  completedBy: number | null;
  completedByName: string | null;
  completedAt: string | null;
}

/**
 * Quem concluiu cada etapa padrao do checklist ("Concluido por <nome> em ...").
 *
 * A atribuicao vive no metadata do evento `checklist_step_changed` — nao ha
 * coluna por etapa em `follow_up_tracking`. Este modulo existe para que a
 * leitura seja a MESMA nos dois consumidores: `GET /api/follow-up/:id` (aba
 * Follow-Up) e `GET /api/processes/:id/checklist` (aba Checklist). Antes a
 * funcao era privada do follow-up e o checklist nao teria como reusa-la sem
 * import circular (follow-up ja importa processes/service).
 *
 * Falha de leitura devolve mapa vazio: a atribuicao e enfeite, e o checklist
 * precisa abrir mesmo sem o historico.
 */
export async function getChecklistStepAttribution(
  processId: number,
): Promise<Record<string, StepCompletedBy>> {
  try {
    const events = await db
      .select({
        metadata: processEvents.metadata,
        createdBy: processEvents.createdBy,
        createdAt: processEvents.createdAt,
        authorName: users.name,
      })
      .from(processEvents)
      .leftJoin(users, eq(processEvents.createdBy, users.id))
      .where(
        and(
          eq(processEvents.processId, processId),
          eq(processEvents.eventType, 'checklist_step_changed'),
        ),
      )
      .orderBy(desc(processEvents.createdAt));

    const map: Record<string, StepCompletedBy> = {};
    for (const ev of events) {
      const meta = (ev.metadata ?? {}) as Record<string, unknown>;
      const step = typeof meta.step === 'string' ? meta.step : null;
      if (!step || meta.newStatus !== 'feito') continue;
      // First occurrence wins because rows are ordered newest-first.
      if (map[step]) continue;
      map[step] = {
        completedBy: ev.createdBy ?? null,
        completedByName:
          (typeof meta.completedByName === 'string' ? meta.completedByName : null) ??
          ev.authorName ??
          null,
        completedAt: typeof meta.completedAt === 'string' ? meta.completedAt : null,
      };
    }
    return map;
  } catch {
    return {};
  }
}
