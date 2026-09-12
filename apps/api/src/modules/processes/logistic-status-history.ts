import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { processEvents } from '../../shared/database/schema.js';

/**
 * Quem decidiu o estagio logistico atual: uma pessoa ou o auto-avanco?
 *
 * Mora fora de `logistic-auto-advance.ts` de proposito — aquele arquivo e
 * derivacao PURA, importada por teste sem banco; trazer a conexao para dentro
 * dele fazia a suite exigir DATABASE_URL para calcular uma regra de negocio.
 */
const STATUS_EVENT_TYPES = ['logistic_status_changed', 'logistic_status_auto_advanced'];

/**
 * O estagio atual foi escolhido por uma PESSOA?
 *
 * `logistic_status_changed` e gravado por `updateLogisticStatus` (a pessoa
 * escolheu no dropdown) e `logistic_status_auto_advanced` pelo proprio
 * auto-avanco. Vale o evento mais recente. Sem nenhum evento, o estagio veio da
 * importacao da planilha — automatico, portanto corrigivel.
 */
export async function isManualLogisticOverride(processId: number): Promise<boolean> {
  const [last] = await db
    .select({ eventType: processEvents.eventType })
    .from(processEvents)
    .where(
      and(
        eq(processEvents.processId, processId),
        inArray(processEvents.eventType, STATUS_EVENT_TYPES),
      ),
    )
    .orderBy(desc(processEvents.createdAt), desc(processEvents.id))
    .limit(1);

  return last?.eventType === 'logistic_status_changed';
}
