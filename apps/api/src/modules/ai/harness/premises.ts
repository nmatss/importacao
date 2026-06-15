/**
 * Knowledge-base lookups específicas DO NOSSO AMBIENTE (premissas + carriers),
 * que um modelo genérico não tem. Mesma disciplina de harness/knowledge.ts:
 * carga via readFileSync (import.meta.url), cache memoizado e DEGRADAÇÃO
 * GRACIOSA — KB ausente/vazio => retorna null/`true` ("não consigo refutar"),
 * para NUNCA gerar falso alarme a partir de catálogo inexistente.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cache = new Map<string, any>();

function load(file: string): any {
  if (cache.has(file)) return cache.get(file);
  let data: any = null;
  try {
    const p = fileURLToPath(new URL(`../knowledge/${file}`, import.meta.url));
    data = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    data = null;
  }
  cache.set(file, data);
  return data;
}

/** Test seam — limpa o cache memoizado (usado por unit tests). */
export function _clearPremisesCache(): void {
  cache.clear();
}

/** Normaliza chave de container/carrier: maiúsculas, sem acento, só [A-Z0-9].
 *  Ex.: "40'NOR + 20'GP" -> "40NOR20GP"; "Hapag-Lloyd (HPL)" -> "HAPAGLLOYDHPL". */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// ── CBM por tipo de container (premissas.json) ───────────────────────────────

/**
 * Teto de CBM físico para um containerType, a partir de premissas.cbmByContainer.
 * Usa o CBM 'real' (capacidade efetiva); se 'real' for null (ex.: 40GP, combos
 * sem real medido), cai para 'nominal' * `nominalFallbackFactor` (default 1.10,
 * folga típica nominal->real observada na própria tabela: 20GP 30->33, 40HQ
 * 68.5->76). Retorna null quando: KB ausente/vazio, type ausente, ou type
 * desconhecido (LCL/Aéreo/combos não tabelados) — caso em que o check NÃO refuta.
 */
export function cbmCeilingForContainer(
  containerType: string | null | undefined,
  nominalFallbackFactor = 1.1,
): { ceiling: number; basis: 'real' | 'nominal' } | null {
  if (!containerType) return null;
  const kb = load('premissas.json');
  const table = kb?.cbmByContainer;
  if (!table || typeof table !== 'object') return null; // degrade gracioso
  const target = norm(containerType);
  if (target.length === 0) return null;
  for (const [key, val] of Object.entries<any>(table)) {
    if (norm(key) !== target) continue;
    const real = val?.real != null ? parseFloat(String(val.real)) : NaN;
    if (Number.isFinite(real)) return { ceiling: real, basis: 'real' };
    const nominal = val?.nominal != null ? parseFloat(String(val.nominal)) : NaN;
    if (Number.isFinite(nominal))
      return { ceiling: nominal * nominalFallbackFactor, basis: 'nominal' };
    return null;
  }
  return null; // tipo não tabelado (LCL/Aéreo/etc.) — não refuta
}

// ── Carriers / shipping lines (carriers.json) ────────────────────────────────

/** Aliases canônicos do nosso ambiente que o modelo costuma emitir sem a sigla
 *  entre parênteses. Mapeia forma normalizada -> nome canônico da lista. */
const CARRIER_ALIASES: Record<string, string> = {
  HPL: 'Hapag-Lloyd (HPL)',
  HAPAGLLOYD: 'Hapag-Lloyd (HPL)',
  HMM: 'Hyundai (HMM)',
  HYUNDAI: 'Hyundai (HMM)',
  MOL: 'Mitsui O.S.K. Lines (MOL)',
  MITSUI: 'Mitsui O.S.K. Lines (MOL)',
  YML: 'YangMing Marine (YML)',
  YANGMING: 'YangMing Marine (YML)',
  MSK: 'MAERSK',
  HSUD: 'Hamburg Sud (H-Sud)',
  HAMBURGSUD: 'Hamburg Sud (H-Sud)',
  ONELINE: 'ONE',
  CMACGM: 'CMA CGM',
  POLYCARGO: 'Poly Cargo',
};

/** Constrói o índice normalizado -> nome canônico a partir de shippingLines,
 *  registrando TANTO o nome completo QUANTO a sigla entre parênteses. */
function carrierIndex(): Map<string, string> | null {
  const kb = load('carriers.json');
  const lines: string[] = kb?.shippingLines;
  if (!Array.isArray(lines) || lines.length === 0) return null; // degrade
  const idx = new Map<string, string>();
  for (const name of lines) {
    if (typeof name !== 'string' || !name.trim()) continue;
    idx.set(norm(name), name); // forma completa ("Hapag-Lloyd (HPL)")
    const m = name.match(/\(([^)]+)\)/); // sigla entre parênteses
    if (m?.[1]) idx.set(norm(m[1]), name);
    const head = name.split('(')[0]; // nome sem a sigla ("Hapag-Lloyd")
    if (head && norm(head)) idx.set(norm(head), name);
  }
  for (const [alias, canonical] of Object.entries(CARRIER_ALIASES)) {
    if (!idx.has(alias)) idx.set(alias, canonical);
  }
  return idx;
}

/** Resolve um carrier/shippingLine extraído para o nome canônico do nosso
 *  ambiente, ou null se desconhecido. KB vazio => retorna o próprio valor
 *  (não refuta). */
export function normalizeCarrier(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const idx = carrierIndex();
  if (!idx) return value; // degrade gracioso: sem catálogo, aceita como está
  return idx.get(norm(value)) ?? null;
}

/** true se o carrier é reconhecido (ou se não há catálogo p/ refutar). */
export function isKnownCarrier(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return true; // vazio: outros checks cuidam
  const idx = carrierIndex();
  if (!idx) return true; // degrade gracioso
  if (norm(value).length < 2) return true; // curto demais p/ refutar
  return idx.has(norm(value));
}
