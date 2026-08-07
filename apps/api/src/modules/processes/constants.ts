/**
 * Catalogo de tipos para `process_operational_records.record_type`.
 *
 * A coluna e varchar(160) livre desde a migration 0022 e ja carrega valores
 * digitados a mao em producao, entao o catalogo NAO vira enum: ele normaliza a
 * grafia quando o texto informado corresponde a um item conhecido e aceita
 * qualquer outro texto como antes. Isso mantem os registros historicos validos
 * e ainda assim faz "lavacao", "LAVAÇÃO" e "Lavação" agregarem como um unico
 * tipo nos relatorios.
 */

/** Custos extras de container/carga cobrados pelo terminal ou pela transportadora. */
export const EXTRA_COST_TYPES = [
  'LAVAÇÃO',
  'REPARO',
  'LAVAÇÃO E REPARO',
  'LAVAGEM QUÍMICA',
  'REMOÇÃO DE DETRITOS',
] as const;

export type ExtraCostType = (typeof EXTRA_COST_TYPES)[number];

/** Compara ignorando caixa, acento e espaco repetido. */
function normalizeForLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_BY_LOOKUP = new Map<string, string>(
  EXTRA_COST_TYPES.map((type) => [normalizeForLookup(type), type]),
);

/**
 * Devolve a grafia canonica quando o texto informado corresponde a um tipo do
 * catalogo; caso contrario devolve o proprio texto apenas com espacos
 * normalizados, preservando a natureza livre do campo.
 */
export function canonicalizeRecordType(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return CANONICAL_BY_LOOKUP.get(normalizeForLookup(trimmed)) ?? trimmed;
}
