/**
 * Motor financeiro — funções puras de cálculo (sem DB, testáveis isoladamente).
 *
 * Fórmulas (fonte: planilha Follow Up, abas Manual/Premissas — docs/REVISAO-100.md §2):
 *  - Valor Aduaneiro = (FOB + frete internacional + seguro) × taxa USD→BRL
 *  - Numerário       = Valor Aduaneiro × 0,6
 *  - %Numerário      = Numerário / Valor Aduaneiro de referência
 *    (sem coluna de "aduaneiro de referência" no banco, a referência usada é o
 *    próprio valor aduaneiro calculado — fração armazenada em numerario_pct)
 *
 * Limiares de alerta (Manual col18 / regra de apólice / free time):
 *  - Invoice baixa:  FOB < USD 20.000           → warning
 *  - Seguro:         valor em USD > USD 150.000 → crítico "ACIONAR SEGURADORA"
 *  - Demurrage:      free time vence em ≤7 dias ou vencido
 */

export const NUMERARIO_FACTOR = 0.6;
export const LOW_INVOICE_THRESHOLD_USD = 20_000;
export const INSURANCE_COVERAGE_LIMIT_USD = 150_000;
export const DEMURRAGE_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type DemurrageStatus = 'ok' | 'expiring' | 'expired';

export interface DemurrageInfo {
  /** Data de vencimento do free time (YYYY-MM-DD) */
  freeTimeEndsAt: string;
  /** Dias até o vencimento (negativo quando já vencido) */
  daysRemaining: number;
  status: DemurrageStatus;
}

export interface NumerarioResult {
  /** Numerário em BRL = Valor Aduaneiro × NUMERARIO_FACTOR */
  numerarioValue: number;
  /**
   * O FATOR de política aplicado — não uma razão medida.
   *
   * Até 2026-08-29 este campo era `numerarioValue / customsValueBrl`. Como
   * `numerarioValue` É `customsValueBrl * NUMERARIO_FACTOR`, a divisão devolvia
   * o fator de volta, sempre: uma constante com aparência de indicador. Quem
   * lesse `numerario_pct` esperando "quanto o numerário representa do aduaneiro
   * de referência" estava lendo 0,6 por construção, nunca uma medição.
   *
   * O nome e o valor no banco continuam os mesmos — o contrato não muda. O que
   * mudou é a expressão deixar de simular um cálculo. Persistir o fator ou
   * fornecer o aduaneiro de referência real é decisão da operação, e trocar a
   * coluna é migration destrutiva: registrado, não decidido aqui.
   */
  numerarioPct: number;
}

export interface FinancialInput {
  fobValueUsd: number | null;
  freightValueUsd: number | null;
  insuranceValueUsd: number | null;
  /** Taxa USD→BRL; null quando não há câmbio registrado para o processo */
  exchangeRate: number | null;
  freeTimeDays: number | null;
  /** Data de descarga/ETA usada como início do free time (etaActual ?? eta) */
  dischargeDate: string | Date | null;
  /** Injetável para testes; default = agora */
  today?: Date;
}

export interface FinancialSnapshot {
  /** 'BRL' quando há taxa USD→BRL; 'USD' quando os valores ficam só em dólar */
  currency: 'BRL' | 'USD';
  exchangeRate: number | null;
  fobValueUsd: number | null;
  freightValueUsd: number | null;
  insuranceValueUsd: number | null;
  customsValueUsd: number | null;
  customsValueBrl: number | null;
  numerario: NumerarioResult | null;
  alerts: {
    /** FOB < USD 20.000 */
    lowInvoice: boolean;
    /** Valor em USD (aduaneiro, ou FOB na falta) > USD 150.000 — acionar seguradora */
    insuranceCoverage: boolean;
    demurrage: DemurrageInfo | null;
  };
  /** Campos ausentes que limitam o cálculo (ex.: 'exchangeRate', 'fobValue') */
  missing: string[];
}

/**
 * Valor aduaneiro em USD = FOB + frete + seguro.
 * FOB é a âncora: sem FOB não há valor aduaneiro. Frete/seguro ausentes
 * entram como zero (subestimação explícita via `missing` no snapshot).
 */
export function computeCustomsValueUsd(
  fobValueUsd: number | null,
  freightValueUsd: number | null,
  insuranceValueUsd: number | null,
): number | null {
  if (fobValueUsd === null || fobValueUsd <= 0) return null;
  return round2(fobValueUsd + (freightValueUsd ?? 0) + (insuranceValueUsd ?? 0));
}

/** Numerário = Valor Aduaneiro (BRL) × 0,6; fração = numerário/aduaneiro. */
export function computeNumerario(customsValueBrl: number): NumerarioResult | null {
  if (!Number.isFinite(customsValueBrl) || customsValueBrl <= 0) return null;
  const numerarioValue = round2(customsValueBrl * NUMERARIO_FACTOR);
  return {
    numerarioValue,
    // O fator, direto. A divisão anterior devolvia exatamente isto, com a
    // aparência de ter medido alguma coisa.
    numerarioPct: round4(NUMERARIO_FACTOR),
  };
}

/** Alerta "Invoice baixa": FOB informado e abaixo de USD 20.000. */
export function isLowInvoice(fobValueUsd: number | null): boolean {
  return fobValueUsd !== null && fobValueUsd > 0 && fobValueUsd < LOW_INVOICE_THRESHOLD_USD;
}

/** Alerta de seguro: valor em USD acima do limite de cobertura da apólice. */
export function exceedsInsuranceCoverage(referenceUsd: number | null): boolean {
  return referenceUsd !== null && referenceUsd > INSURANCE_COVERAGE_LIMIT_USD;
}

function toUtcDateOnly(value: string | Date): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  // Colunas `date` do Postgres chegam como 'YYYY-MM-DD'
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Demurrage: vencimento do free time = descarga/ETA + freeTimeDays.
 * Retorna null quando falta a data-base ou o free time (sem dado, sem alerta).
 */
export function computeDemurrage(
  dischargeDate: string | Date | null,
  freeTimeDays: number | null,
  today: Date = new Date(),
): DemurrageInfo | null {
  if (dischargeDate === null || freeTimeDays === null || freeTimeDays < 0) return null;

  const start = toUtcDateOnly(dischargeDate);
  const reference = toUtcDateOnly(today);
  if (!start || !reference) return null;

  const endsAt = new Date(start.getTime() + freeTimeDays * MS_PER_DAY);
  const daysRemaining = Math.round((endsAt.getTime() - reference.getTime()) / MS_PER_DAY);

  let status: DemurrageStatus = 'ok';
  if (daysRemaining < 0) status = 'expired';
  else if (daysRemaining <= DEMURRAGE_WARNING_DAYS) status = 'expiring';

  return {
    freeTimeEndsAt: endsAt.toISOString().slice(0, 10),
    daysRemaining,
    status,
  };
}

/** Snapshot financeiro completo a partir de dados planos (sem DB). */
export function buildFinancialSnapshot(input: FinancialInput): FinancialSnapshot {
  const missing: string[] = [];
  if (input.fobValueUsd === null) missing.push('fobValue');
  if (input.freightValueUsd === null) missing.push('freightValue');
  if (input.insuranceValueUsd === null) missing.push('insuranceValue');
  if (input.exchangeRate === null) missing.push('exchangeRate');
  if (input.freeTimeDays === null) missing.push('freeTimeDays');

  const customsValueUsd = computeCustomsValueUsd(
    input.fobValueUsd,
    input.freightValueUsd,
    input.insuranceValueUsd,
  );

  const hasRate = input.exchangeRate !== null && input.exchangeRate > 0;
  const customsValueBrl =
    customsValueUsd !== null && hasRate ? round2(customsValueUsd * input.exchangeRate!) : null;

  return {
    currency: hasRate ? 'BRL' : 'USD',
    exchangeRate: hasRate ? input.exchangeRate : null,
    fobValueUsd: input.fobValueUsd,
    freightValueUsd: input.freightValueUsd,
    insuranceValueUsd: input.insuranceValueUsd,
    customsValueUsd,
    customsValueBrl,
    numerario: customsValueBrl !== null ? computeNumerario(customsValueBrl) : null,
    alerts: {
      lowInvoice: isLowInvoice(input.fobValueUsd),
      insuranceCoverage: exceedsInsuranceCoverage(customsValueUsd ?? input.fobValueUsd),
      demurrage: computeDemurrage(input.dischargeDate, input.freeTimeDays, input.today),
    },
    missing,
  };
}
