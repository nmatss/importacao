/**
 * Nucleo PURO do comparativo documental.
 *
 * Tudo aqui e funcao pura: sem banco, sem IO, sem `Date.now()`. O motivo e
 * duplo — (1) o comparativo passou a ser testavel linha a linha, sem montar o
 * mock do Drizzle; (2) a tela de Registro (DUIMP) reusa as MESMAS regras de
 * status, tolerancia e casamento de item, em vez de reimplementa-las
 * (decisao D9 da reuniao 11/09).
 *
 * Regra de ouro: nada aqui altera o dado extraido. Normalizacao (zeros a
 * esquerda, pontuacao de CNPJ, prefixo "CNPJ:" no endereco do espelho) existe
 * so para COMPARAR; o valor exibido continua o da fonte.
 */
import { portsMatch as normalizedPortsMatch } from '../validation/utils/port-normalize.js';
import { normalizeCompanyName } from '../validation/utils/name-normalize.js';
import { compareDates } from '../validation/utils/date-compare.js';
import {
  itemCodeCandidates,
  itemCodesMatchLoose,
  normalizeItemCode,
  stripLeadingZeros,
} from '../validation/utils/item-code-normalize.js';
import { normalizeGtin } from '../ai/harness/format.js';

export type RowStatus =
  | 'match'
  | 'warning'
  | 'divergent'
  | 'empty'
  | 'single_source'
  /**
   * Verificacao NAO REALIZADA por indisponibilidade (integracao fora do ar,
   * dado ausente na fonte). Reuniao 11/09: "o Odoo nao respondeu" e "Ignorado:
   * nenhum valor de frete disponivel" apareciam como ATENCAO e inflavam a
   * contagem de pendencias. Visivel, mas fora da conta.
   */
  | 'skipped';

export type Criticality = 'critical' | 'secondary' | 'info';

export type ComparisonKind = 'string' | 'numeric' | 'port' | 'date' | 'name' | 'taxId';

export interface ComparisonCheckResult {
  id?: number | null;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string | null;
  actualValue?: string | null;
  documentsCompared?: string | null;
  message?: string | null;
}

/** Ordem de severidade: o pior status da linha prevalece. */
const STATUS_SEVERITY: Record<RowStatus, number> = {
  divergent: 5,
  warning: 4,
  match: 3,
  single_source: 2,
  skipped: 1,
  empty: 0,
};

export function highestRowStatus(...statuses: RowStatus[]): RowStatus {
  let worst: RowStatus = 'empty';
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}

export function checkStatusToRowStatus(status: ComparisonCheckResult['status']): RowStatus {
  switch (status) {
    case 'failed':
      return 'divergent';
    case 'warning':
      return 'warning';
    case 'passed':
      return 'match';
    default:
      return 'skipped';
  }
}

export function comparisonRowKey(
  scope: 'aggregate' | 'item',
  value: unknown,
  index: number,
): string {
  const raw = String(value ?? `linha-${index + 1}`)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${scope}:${raw || `linha-${index + 1}`}`;
}

export function aggregateMessage(status: RowStatus, criticality: Criticality) {
  if (status === 'empty') return 'Sem dados extraidos para comparar.';
  if (status === 'single_source') {
    return 'Fonte unica — nenhum outro documento disponivel para corroborar este valor.';
  }
  if (status === 'match') return 'Conforme entre os documentos disponiveis.';
  if (status === 'warning' && criticality === 'secondary') {
    return 'Divergencia secundaria registrada como atencao.';
  }
  if (status === 'warning') return 'Divergencia pequena ou informativa; revisar antes do envio.';
  if (status === 'skipped') return 'Nao verificado.';
  return 'Divergencia entre documentos; requer correcao ou aceite.';
}

export function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * So os digitos de um CPF/CNPJ. Reuniao 11/09 [11:36]: "esse CNPJ e o mesmo
 * desse aqui. A diferenca e que um esta com ponto e um esta sem ponto. Ele esta
 * trazendo como errado."
 */
export function taxIdDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/** Tax id estrangeiro (nao tem 11/14 digitos): compara letras e numeros. */
function taxIdAlphanumeric(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * O endereco do importador no espelho vem com o CNPJ colado na frente
 * ("CNPJ: 58.500.398/0006-10 RUA GERCINO MACHADO, 207"), o que fazia a linha
 * "Importador — Endereco" divergir da Invoice/PL. Limpa so para a leitura.
 */
export function stripTaxIdPrefix(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const cleaned = text
    .replace(/^(cnpj|cpf|c\.n\.p\.j\.?|tax\s*id)\s*[:-]?\s*[\d.\-/]{11,20}\s*[,;-]?\s*/i, '')
    .trim();
  return cleaned || text;
}

export function computeRowStatus(
  values: unknown[],
  kind: ComparisonKind,
  dateOpts?: { matchDays?: number; warnDays?: number },
): RowStatus {
  if (values.length === 0) return 'empty';
  // FALSO VERDE (auditoria 2026-07-17): um valor sozinho não "confere" com nada
  // — verde aqui fazia um Incoterm errado extraído só da Invoice parecer
  // validado. Estado neutro próprio, nem conforme nem divergente.
  if (values.length === 1) return 'single_source';

  if (kind === 'date') {
    return compareDates(values, dateOpts) as RowStatus;
  }

  if (kind === 'taxId') {
    // Identificador fiscal é comparado por DÍGITO. O ramo string fazia
    // trim+lowercase e, no fallback, `parseFloat('58.500.398/0006-10')` = 58.5.
    const digits = values.map((value) => taxIdDigits(value));
    if (digits.every((d) => d.length === 11 || d.length === 14)) {
      const base = digits[0];
      return digits.every((d) => d === base) ? 'match' : 'divergent';
    }
    const alphanumeric = values.map((value) => taxIdAlphanumeric(value));
    const base = alphanumeric[0];
    if (!base) return 'empty';
    return alphanumeric.every((value) => value === base) ? 'match' : 'divergent';
  }

  if (kind === 'port') {
    const base = values[0];
    const allEqual = values.every((value) => normalizedPortsMatch(base, value));
    return allEqual ? 'match' : 'divergent';
  }

  if (kind === 'name') {
    // Compare normalized company names; tolerate punctuation/suffix differences.
    const norm = values.map((v) => normalizeCompanyName(v));
    const base = norm[0];
    if (!base) return 'empty';
    const allEqual = norm.every((n) => n === base);
    if (allEqual) return 'match';
    // Soft tolerance: prefix match counts as warning, not divergent
    const allPrefix = norm.every((n) => n.startsWith(base) || base.startsWith(n));
    return allPrefix ? 'warning' : 'divergent';
  }

  if (kind === 'numeric') {
    const nums = values.map((v) => parseFloat(String(v).replace(',', '.')));
    if (nums.some((n) => isNaN(n))) return 'divergent';
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    const diff = max - min;
    const denom = Math.max(Math.abs(max), 1);
    if (diff < 0.5 || diff / denom < 0.005) return 'match';
    if (diff / denom < 0.02) return 'warning';
    return 'divergent';
  }

  // Default string comparison
  const norm = values.map((v) => String(v).trim().toLowerCase());
  const base = norm[0];
  if (norm.every((n) => n === base)) return 'match';
  // Numeric fallback for cases where the field happens to be numeric
  const nums = norm.map((n) => parseFloat(n));
  if (nums.every((n) => !isNaN(n))) {
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    return max - min < 0.5 ? 'match' : 'divergent';
  }
  return 'divergent';
}

export function isInvoiceFreeOfCharge(item: Record<string, any>): boolean {
  const total = toNumberOrNull(item.totalPrice);
  const unit = toNumberOrNull(item.unitPrice);
  const marker = String(item.notes ?? item.observations ?? item.description ?? item.descricao ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    item.isFreeOfCharge === true ||
    total === 0 ||
    marker.includes('free of charge') ||
    marker.includes('foc') ||
    marker.includes('discount') ||
    marker.includes('desconto') ||
    marker.includes('bonificacao') ||
    marker.includes('bonificado') ||
    unit === 0
  );
}

export function buildItemDivergence(input: {
  matched: boolean;
  espelhoMatched: boolean;
  hasEspelho: boolean;
  quantityDiverges: boolean;
  espelhoDiverges: boolean;
  isFreeOfCharge: boolean;
  manufacturerDiverges?: boolean;
  ncmDiverges?: boolean;
  unitPriceDiverges?: boolean;
  totalPriceDiverges?: boolean;
  eanDiverges?: boolean;
  weightRatioMessage?: string | null;
}): string {
  if (input.isFreeOfCharge) return 'FOC/desconto identificado na Invoice';
  if (!input.matched) return 'Item nao localizado no Packing List';
  if (input.hasEspelho && !input.espelhoMatched) return 'Item nao localizado no Espelho';
  const divergences: string[] = [];
  if (input.quantityDiverges) divergences.push('quantidade Invoice x Packing List');
  if (input.espelhoDiverges) divergences.push('quantidade Invoice x Espelho');
  if (input.manufacturerDiverges) divergences.push('fabricante INV x PL x Espelho');
  if (input.ncmDiverges) divergences.push('NCM Invoice x Espelho');
  if (input.unitPriceDiverges) divergences.push('preco unitario Invoice x Espelho');
  if (input.totalPriceDiverges) divergences.push('valor total Invoice x Espelho');
  if (input.eanDiverges) divergences.push('EAN Invoice x Espelho');
  if (input.weightRatioMessage) divergences.push(input.weightRatioMessage);
  return divergences.length > 0 ? divergences.join('; ') : 'Sem divergencia';
}

export function manufacturerValuesDiverge(values: unknown[]): boolean {
  const normalized = values
    .filter((value) => value != null && value !== '')
    .map((value) => normalizeCompanyName(value))
    .filter(Boolean);
  if (normalized.length <= 1) return false;
  // Compara todos os pares (não só contra o primeiro): 'ACME X' vs 'ACME Y'
  // diverge mesmo quando ambos casam por prefixo com 'ACME'. Prefixo mútuo
  // continua tolerado para absorver sufixos societários/ruído de extração.
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const a = normalized[i];
      const b = normalized[j];
      if (a !== b && !a.startsWith(b) && !b.startsWith(a)) return true;
    }
  }
  return false;
}

export function normalizeStringList(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of rawValues.flatMap((item) =>
    typeof item === 'string' ? item.split(/[;\n]/) : [item],
  )) {
    const text = String(raw ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!text) continue;
    const key = normalizeCompanyName(text) || text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }

  return result;
}

export function compareItemWeightRatio(input: {
  invoiceNetWeight: number | null;
  invoiceGrossWeight: number | null;
  plNetWeight: number | null;
  plGrossWeight: number | null;
}): { status: RowStatus; message: string | null } {
  const ratio = (gross: number | null, net: number | null) => {
    if (gross == null || net == null || net <= 0 || gross <= 0) return null;
    return gross / net;
  };
  const invoiceRatio = ratio(input.invoiceGrossWeight, input.invoiceNetWeight);
  const plRatio = ratio(input.plGrossWeight, input.plNetWeight);
  if (invoiceRatio == null && plRatio == null) return { status: 'empty', message: null };
  if (
    (input.invoiceGrossWeight != null &&
      input.invoiceNetWeight != null &&
      input.invoiceGrossWeight < input.invoiceNetWeight) ||
    (input.plGrossWeight != null &&
      input.plNetWeight != null &&
      input.plGrossWeight < input.plNetWeight)
  ) {
    return { status: 'divergent', message: 'peso bruto menor que peso liquido' };
  }
  if (invoiceRatio == null || plRatio == null) return { status: 'warning', message: null };
  const diffPct = Math.abs(invoiceRatio - plRatio) / Math.max(invoiceRatio, plRatio, 1);
  if (diffPct <= 0.15) return { status: 'match', message: null };
  if (diffPct <= 0.25)
    return { status: 'warning', message: 'proporcao peso bruto/liquido fora da margem de 15%' };
  return { status: 'divergent', message: 'proporcao peso bruto/liquido divergente' };
}

export function itemComparisonMessage(
  status: RowStatus,
  divergence: string,
  isFreeOfCharge: boolean,
): string {
  if (isFreeOfCharge) return 'Diferença explicada por item FOC/desconto identificado na Invoice';
  if (status === 'match') return 'Item conforme entre os documentos disponiveis.';
  if (status === 'warning') return `${divergence}; revisar ou aceitar operacionalmente.`;
  return `${divergence}; requer correcao ou aceite.`;
}

export function itemIdentityMatches(
  left: Record<string, any>,
  right: Record<string, any>,
): boolean {
  const leftEan = normalizeGtin(left.ean ?? left.ean13);
  const rightEan = normalizeGtin(right.ean ?? right.ean13);
  if (leftEan && rightEan && leftEan === rightEan) return true;

  const leftCodes = itemCodeCandidates(left);
  const rightCodes = itemCodeCandidates(right);
  return leftCodes.some((leftCode) =>
    rightCodes.some((rightCode) => itemCodesMatchLoose(leftCode, rightCode)),
  );
}

/** Casamento por prefixo da descricao, o ultimo recurso quando falta codigo. */
function descriptionOverlaps(left: Record<string, any>, right: Record<string, any>): boolean {
  const leftDesc = left.description ?? left.descricao;
  const rightDesc = right.description ?? right.descricao;
  return Boolean(
    leftDesc &&
    rightDesc &&
    String(leftDesc).toLowerCase().includes(String(rightDesc).toLowerCase().slice(0, 20)),
  );
}

export function itemsCorrespond(left: Record<string, any>, right: Record<string, any>): boolean {
  return itemIdentityMatches(left, right) || descriptionOverlaps(left, right);
}

/**
 * Escolhe a linha correspondente no outro documento.
 *
 * Um SKU pode aparecer em MAIS DE UMA linha (o PK220 tem 050404509 duas vezes,
 * de PIs diferentes). `Array.find` devolvia sempre a primeira, e a segunda
 * linha da invoice era comparada contra a quantidade da primeira — divergencia
 * inventada. Aqui a primeira linha ainda nao usada vence; se todas ja foram
 * usadas, cai na primeira (nenhum item deixa de casar por causa disso).
 */
export function findCorrespondingItem<T extends Record<string, any>>(
  item: Record<string, any>,
  candidates: T[],
  used: Set<T>,
): T | undefined {
  const matching = candidates.filter((candidate) => itemsCorrespond(candidate, item));
  if (matching.length === 0) return undefined;
  const available = matching.find((candidate) => !used.has(candidate));
  const chosen = available ?? matching[0];
  used.add(chosen);
  return chosen;
}

/**
 * Soma das quantidades dos itens. `null` quando NENHUM item trouxe quantidade —
 * zero aqui seria "0 pecas", que e uma afirmacao, nao a ausencia de leitura.
 */
export function sumItemQuantities(items: Array<Record<string, any>>): number | null {
  let total: number | null = null;
  for (const item of items) {
    const quantity = toNumberOrNull(item?.quantity ?? item?.qty);
    if (quantity == null) continue;
    total = (total ?? 0) + quantity;
  }
  return total;
}

/** Divergencia numerica com tolerancia relativa (precos, NCM nao entra aqui). */
export function numericValuesDiverge(
  a: number | null,
  b: number | null,
  tolerance = 0.005,
): boolean {
  if (a == null || b == null) return false;
  const diff = Math.abs(a - b);
  if (diff === 0) return false;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff > 0.009 && diff / denom > tolerance;
}

/** NCM comparado so pelos digitos (8 digitos, com ou sem ponto). */
export function ncmValuesDiverge(a: unknown, b: unknown): boolean {
  const da = String(a ?? '').replace(/\D/g, '');
  const db = String(b ?? '').replace(/\D/g, '');
  if (!da || !db) return false;
  return da !== db;
}

export function eanValuesDiverge(a: unknown, b: unknown): boolean {
  const ea = normalizeGtin(a);
  const eb = normalizeGtin(b);
  if (!ea || !eb) return false;
  return ea !== eb;
}

/** Codigos de item iguais depois de normalizar zeros a esquerda e pontuacao. */
export function sameItemCode(a: unknown, b: unknown): boolean {
  const na = stripLeadingZeros(normalizeItemCode(a));
  const nb = stripLeadingZeros(normalizeItemCode(b));
  return Boolean(na) && na === nb;
}

/* ------------------------------------------------------------------------ *
 * Cruzamentos (validation checks) dentro das linhas agregadas
 * ------------------------------------------------------------------------ */

/**
 * Rotulo em portugues de cada check. O comparativo mostrava a chave tecnica
 * crua ("invoice-pl-date-tolerance") quando o check nao estava no catalogo da
 * web. A guarda estatica em `__tests__/cross-check-classificacao.test.ts` falha
 * se um check novo ficar sem rotulo.
 */
export const CHECK_LABELS: Record<string, string> = {
  'exporter-match': 'Exportador',
  'importer-match': 'Importador',
  'process-reference': 'Referencia do processo',
  'incoterm-check': 'Incoterm',
  'ports-match': 'Portos',
  'dates-match': 'Datas (ETD/embarque)',
  'invoice-pl-date-tolerance': 'Datas Invoice x Packing List',
  'date-sequence-check': 'Sequencia de datas',
  'currency-check': 'Moeda',
  'fob-calculation': 'Calculo FOB (itens x total)',
  'description-odoo-match': 'Descricao dos itens no Odoo',
  'box-quantity-match': 'Quantidade de volumes',
  'net-weight-match': 'Peso liquido',
  'gross-weight-match': 'Peso bruto',
  'cbm-match': 'Cubagem (CBM)',
  'freight-value-match': 'Valor do frete',
  'unit-type-validation': 'Tipo de unidade',
  'manufacturer-completeness': 'Completude do fabricante',
  'ncm-bl-description': 'NCM do BL x Espelho',
  'invoice-value-vs-fup': 'Valor da Invoice x Follow-up',
  'freight-vs-fup': 'Frete x Follow-up',
  'cbm-vs-fup': 'CBM x Follow-up',
  'container-type-vs-fup': 'Tipo de container x Follow-up',
  'item-level-match': 'Correspondencia de itens',
  'payment-terms-check': 'Condicoes de pagamento',
  'weight-ratio-check': 'Proporcao peso bruto/liquido',
  'supplier-address-match': 'Endereco do fornecedor',
  'certificate-completeness': 'Completude do certificado',
  'document-set-completeness': 'Conjunto de documentos',
};

export function checkLabel(checkName: string): string {
  return CHECK_LABELS[checkName] ?? checkName;
}

/**
 * checkName -> rotulo(s) da linha agregada que ja mostra os MESMOS valores.
 * Reuniao 11/09 [12:08]: "tem um monte de coisa repetida: FOB, referencia do
 * processo... cubagem repetida... organizar nas colunas para padronizar com o
 * de cima". O cruzamento deixa de virar linha propria; vira a regra que decide
 * o status da linha, com a mensagem explicando qual regra reprovou.
 */
export const CROSS_CHECK_TARGET_ROWS: Record<string, string[]> = {
  'exporter-match': ['Exportador / Shipper'],
  'importer-match': ['Importador / Consignee'],
  'process-reference': ['Invoice Number / Order Ref'],
  'incoterm-check': ['Incoterm'],
  'currency-check': ['Moeda'],
  'ports-match': ['Porto Embarque', 'Porto Destino'],
  'dates-match': ['Datas documentais (emissão / embarque)'],
  'invoice-pl-date-tolerance': ['Datas documentais (emissão / embarque)'],
  'date-sequence-check': ['Datas documentais (emissão / embarque)'],
  'fob-calculation': ['Total FOB (USD)'],
  'box-quantity-match': ['Total Caixas'],
  'net-weight-match': ['Peso Liquido (kg)'],
  'gross-weight-match': ['Peso Bruto (kg)'],
  'cbm-match': ['CBM (m3)'],
  'freight-value-match': ['Frete'],
  'invoice-value-vs-fup': ['Total FOB (USD)'],
  'freight-vs-fup': ['Frete'],
  'cbm-vs-fup': ['CBM (m3)'],
  'container-type-vs-fup': ['Tipo Container'],
};

/**
 * Checks que NAO viram linha do comparativo: ou tem painel proprio (itens,
 * fabricantes, proporcao de peso), ou repetem um aviso que a tela ja da.
 */
export const HIDDEN_CROSS_CHECKS = new Set([
  'manufacturer-completeness',
  'supplier-address-match',
  'payment-terms-check',
  'certificate-completeness',
  'weight-ratio-check',
  'item-level-match',
  'unit-type-validation',
  'document-set-completeness',
]);

/** Checks sem linha equivalente: viram linha propria, com colunas de verdade. */
export const STANDALONE_CROSS_CHECKS: Record<
  string,
  { label: string; expectedColumn: ComparisonColumn; actualColumn: ComparisonColumn }
> = {
  // Eduarda pediu explicitamente para MANTER "NCM BL versus espelho".
  'ncm-bl-description': {
    label: 'NCM (BL x Espelho)',
    expectedColumn: 'espelho',
    actualColumn: 'bl',
  },
  'description-odoo-match': {
    label: 'Descricao dos itens (Odoo)',
    expectedColumn: 'system',
    actualColumn: 'invoice',
  },
};

export type ComparisonColumn = 'invoice' | 'packingList' | 'bl' | 'espelho' | 'system';

export interface ComparisonRow {
  rowKey: string;
  label: string;
  invoice: string | null;
  packingList: string | null;
  bl: string | null;
  espelho: string | null;
  system: string | null;
  status: RowStatus;
  criticality: Criticality;
  message: string | null;
  [extra: string]: unknown;
}

/** "Ignorado: X" vira o motivo de "Nao verificado — X". */
function reasonFromMessage(message: string | null | undefined): string {
  const text = String(message ?? '').trim();
  if (!text) return 'motivo nao informado';
  return text.replace(/^ignorado\s*:\s*/i, '').replace(/\.$/, '');
}

export function skippedMessage(message: string | null | undefined): string {
  return `Nao verificado — ${reasonFromMessage(message)}`;
}

/**
 * Incorpora os resultados de validacao as linhas agregadas.
 *
 * - check mapeado: entra na linha correspondente (status + mensagem da regra);
 * - check oculto: ignorado (tem painel proprio);
 * - check avulso: vira linha nova com os valores NAS COLUNAS certas;
 * - check `skipped`: linha fica "Nao verificado — motivo", visivel e FORA da
 *   contagem de atencoes.
 */
export function mergeValidationChecks(
  rows: ComparisonRow[],
  checks: ComparisonCheckResult[],
  /**
   * Aceite vigente da linha. As linhas avulsas (NCM BL x Espelho, Odoo) tem
   * rowKey ESTAVEL — antes a chave levava o id do check, que muda a cada run, e
   * o aceite sumia na revalidacao seguinte.
   */
  resolveAcceptance?: (rowKey: string) => unknown,
): ComparisonRow[] {
  const byLabel = new Map<string, ComparisonRow>();
  for (const row of rows) byLabel.set(row.label, row);

  const standalone: ComparisonRow[] = [];
  const rowsWithRule = new Set<ComparisonRow>();

  for (const check of checks) {
    if (HIDDEN_CROSS_CHECKS.has(check.checkName)) continue;
    const checkStatus = checkStatusToRowStatus(check.status);
    const label = checkLabel(check.checkName);

    const targets = CROSS_CHECK_TARGET_ROWS[check.checkName];
    if (targets) {
      for (const target of targets) {
        const row = byLabel.get(target);
        if (!row) continue;
        applyCheckToRow(row, check, checkStatus, label, rowsWithRule);
      }
      continue;
    }

    const standaloneSpec = STANDALONE_CROSS_CHECKS[check.checkName];
    if (!standaloneSpec) continue;
    if (checkStatus === 'empty') continue;

    const standaloneRowKey = comparisonRowKey('aggregate', standaloneSpec.label, standalone.length);
    const row: ComparisonRow = {
      rowKey: standaloneRowKey,
      label: standaloneSpec.label,
      invoice: null,
      packingList: null,
      bl: null,
      espelho: null,
      system: null,
      status: checkStatus,
      criticality: 'critical',
      message:
        checkStatus === 'skipped'
          ? skippedMessage(check.message)
          : (check.message ?? aggregateMessage(checkStatus, 'critical')),
      overrides: [],
      accepted: resolveAcceptance?.(standaloneRowKey) ?? null,
    };
    row[standaloneSpec.expectedColumn] = check.expectedValue ?? null;
    row[standaloneSpec.actualColumn] = check.actualValue ?? null;
    standalone.push(row);
  }

  return [...rows, ...standalone];
}

function applyCheckToRow(
  row: ComparisonRow,
  check: ComparisonCheckResult,
  checkStatus: RowStatus,
  label: string,
  rowsWithRule: Set<ComparisonRow>,
) {
  if (checkStatus === 'skipped') {
    // Nao piora a linha: so explica que a regra nao rodou.
    const reason = skippedMessage(check.message);
    row.message =
      row.status === 'empty' ? reason : `${row.message ?? ''} ${label}: ${reason}`.trim();
    if (row.status === 'empty') row.status = 'skipped';
    return;
  }

  const previousStatus = row.status;
  row.status = highestRowStatus(row.status, checkStatus);

  if (checkStatus === 'divergent' || checkStatus === 'warning') {
    const detail = check.message ?? aggregateMessage(checkStatus, row.criticality);
    // Duas regras podem reprovar a mesma linha (ex.: ETD tem dates-match e a
    // tolerancia INV x PL). Somar as mensagens em vez de deixar a ultima
    // sobrescrever: o operador precisa saber QUAIS regras reprovaram.
    row.message = rowsWithRule.has(row)
      ? `${row.message ?? ''} | ${label}: ${detail}`.trim()
      : `${label}: ${detail}`;
    rowsWithRule.add(row);
    return;
  }

  // Check conforme: a mensagem da linha so muda quando ela nao tinha nada a
  // dizer (evita apagar a explicacao de uma divergencia ja registrada).
  if (previousStatus === 'empty' || previousStatus === 'skipped') {
    row.message = check.message ?? aggregateMessage(row.status, row.criticality);
  }
}
