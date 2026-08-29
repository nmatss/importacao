/**
 * Unidades de medida declaradas junto dos numeros extraidos.
 *
 * Nenhum schema de extracao tem campo de unidade (nem peso, nem volume): o
 * prompt manda a IA devolver KG e m3, e os checks comparavam numeros assumindo
 * isso em silencio. Quando a unidade VEM ESCRITA no valor ("1234.56 KGS",
 * "850 LBS", "1200 CFT"), da para conferir — e e obrigacao conferir antes de
 * declarar divergencia documental.
 *
 * Politica adotada (e reportada ao operador):
 * - unidade nenhuma declarada em lugar nenhum -> segue a convencao do prompt
 *   (KG / m3), porque exigir confirmacao explicita desligaria todos os checks
 *   de peso e volume do sistema;
 * - unidades declaradas divergentes entre si, ou diferentes da convencao ->
 *   nao compara numero: reporta "unidade divergente" como warning.
 */

const WEIGHT_UNITS: Record<string, string> = {
  KG: 'KG',
  KGS: 'KG',
  KGM: 'KG',
  QUILO: 'KG',
  QUILOS: 'KG',
  G: 'G',
  GR: 'G',
  GRS: 'G',
  GRAMS: 'G',
  LB: 'LB',
  LBS: 'LB',
  POUND: 'LB',
  POUNDS: 'LB',
  T: 'T',
  TON: 'T',
  TONS: 'T',
  MT: 'T',
  TONNE: 'T',
};

const VOLUME_UNITS: Record<string, string> = {
  M3: 'M3',
  'M³': 'M3',
  CBM: 'M3',
  MTQ: 'M3',
  CBMS: 'M3',
  CFT: 'CFT',
  FT3: 'CFT',
  CUFT: 'CFT',
  L: 'L',
  LT: 'L',
  LTS: 'L',
};

/** Unidade assumida quando o documento nao declara nenhuma. */
export const ASSUMED_WEIGHT_UNIT = 'KG';
export const ASSUMED_VOLUME_UNIT = 'M3';

export function normalizeWeightUnit(token: string | null | undefined): string | null {
  if (!token) return null;
  return WEIGHT_UNITS[token.trim().toUpperCase()] ?? null;
}

export function normalizeVolumeUnit(token: string | null | undefined): string | null {
  if (!token) return null;
  return VOLUME_UNITS[token.trim().toUpperCase()] ?? null;
}

export interface LabeledUnit {
  label: string;
  /** Token cru capturado junto do numero ("KGS", "LBS", "CFT"). */
  unit: string | null;
}

/**
 * Retorna `null` quando as unidades declaradas sao compativeis com a convencao
 * assumida (ou quando nenhuma foi declarada). Caso contrario, devolve o texto
 * que impede a comparacao numerica.
 */
export function describeUnitDivergence(
  entries: LabeledUnit[],
  normalize: (token: string | null | undefined) => string | null,
  assumed: string,
): string | null {
  const declared = entries
    .map((entry) => ({ label: entry.label, raw: entry.unit, code: normalize(entry.unit) }))
    .filter((entry) => entry.raw != null);

  if (declared.length === 0) return null;

  const unrecognized = declared.filter((entry) => entry.code == null);
  const offConvention = declared.filter((entry) => entry.code != null && entry.code !== assumed);

  if (offConvention.length === 0 && unrecognized.length === 0) return null;

  const describe = (list: typeof declared) =>
    list.map((entry) => `${entry.label}="${entry.raw}"`).join(', ');

  const parts: string[] = [];
  if (offConvention.length > 0) {
    parts.push(`unidade declarada diferente de ${assumed}: ${describe(offConvention)}`);
  }
  if (unrecognized.length > 0) {
    // Nao da para afirmar que o numero esta em ${assumed}: reportar em vez de
    // supor. Ver a politica no cabecalho do modulo.
    parts.push(`unidade nao reconhecida (esperado ${assumed}): ${describe(unrecognized)}`);
  }
  return parts.join('; ');
}
