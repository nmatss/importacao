import { normalizeItemCode } from '../utils/item-code-normalize.js';
import { companySimilarity } from '../utils/name-normalize.js';
import { parseDocumentNumber } from '../utils/number-normalize.js';

interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

/**
 * Limiar de similaridade das descricoes de item.
 *
 * O fuzzy anterior aceitava qualquer par que compartilhasse 80% dos CARACTERES
 * do texto mais curto — duas descricoes com o mesmo alfabeto e sentidos opostos
 * casavam, e o contador de divergencia de descricao era zero na pratica.
 * `companySimilarity` (Jaccard de tokens + Levenshtein) mede sobreposicao real.
 *
 * 0.70 foi escolhido por medicao em pares reais deste dominio:
 *   "LANTERNA DE LED" x "LANTERNA LED"        -> 0.73  (mesma peca, deve passar)
 *   "Kids socks dino" x "Kids socks stripe"   -> 0.59  (pecas diferentes, deve acusar)
 * Descricao divergente permanece `warning`: e sinal de conferencia, nao prova
 * documental suficiente para abrir correcao com o fornecedor.
 */
export const ITEM_DESCRIPTION_SIMILARITY_THRESHOLD = 0.7;

export function descriptionsMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return true;
  if (na === nb) return true;
  return companySimilarity(a, b) >= ITEM_DESCRIPTION_SIMILARITY_THRESHOLD;
}

interface AggregatedItem {
  code: string;
  /** Quantas linhas do documento carregam este codigo (cor/tamanho repetem o SKU). */
  lines: number;
  /** Soma das quantidades lidas; `null` quando nenhuma linha trouxe quantidade. */
  quantity: number | null;
  /** Linhas em que a quantidade nao veio ou veio ilegivel. */
  quantityGaps: number;
  descriptions: string[];
}

interface Aggregation {
  byCode: Map<string, AggregatedItem>;
  lineCount: number;
  linesWithoutCode: number;
}

/**
 * Agrega por codigo em vez de sobrescrever. `Map.set(code, item)` fazia a ultima
 * linha de um SKU repetido (cor/tamanho) apagar as anteriores: so uma era
 * comparada e `map.size` era reportado ao operador como "N itens conferidos",
 * numero que nao correspondia a invoice.
 */
function aggregate(items: Array<Record<string, any>>): Aggregation {
  const byCode = new Map<string, AggregatedItem>();
  let linesWithoutCode = 0;

  for (const item of items) {
    const code = normalizeItemCode(item.itemCode ?? item.code);
    if (!code) {
      linesWithoutCode++;
      continue;
    }

    const current = byCode.get(code) ?? {
      code,
      lines: 0,
      quantity: null,
      quantityGaps: 0,
      descriptions: [],
    };

    current.lines++;

    const parsedQuantity = parseDocumentNumber(item.quantity);
    if (parsedQuantity.ok) {
      current.quantity = (current.quantity ?? 0) + parsedQuantity.value;
    } else {
      // Quantidade ausente NAO vira 0: `Number(x ?? 0)` fazia 0 === 0 passar
      // como se as quantidades conferissem.
      current.quantityGaps++;
    }

    const description = String(item.description ?? '').trim();
    if (description) current.descriptions.push(description);

    byCode.set(code, current);
  }

  return { byCode, lineCount: items.length, linesWithoutCode };
}

export default function itemLevelMatch(input: CheckInput): CheckResult {
  const checkName = 'item-level-match';

  if (!input.invoiceData) {
    return {
      checkName,
      status: 'skipped',
      documentsCompared: 'INV vs PL',
      message: 'aguardando INV',
    };
  }

  const invItems = input.invoiceData?.items as Array<Record<string, any>> | undefined;
  const plItems = input.packingListData?.items as Array<Record<string, any>> | undefined;

  if (!invItems || invItems.length === 0 || !plItems || plItems.length === 0) {
    return {
      checkName,
      status: 'warning',
      documentsCompared: 'INV vs PL',
      message: 'Nenhum item encontrado em um ou ambos os documentos para comparar.',
    };
  }

  const inv = aggregate(invItems);
  const pl = aggregate(plItems);

  const issues: string[] = [];
  const warnings: string[] = [];

  const missingFromPl = [...inv.byCode.keys()].filter((code) => !pl.byCode.has(code));
  const missingFromInv = [...pl.byCode.keys()].filter((code) => !inv.byCode.has(code));

  if (missingFromPl.length > 0) {
    issues.push(`Itens na INV ausentes na PL: ${missingFromPl.join(', ')}`);
  }
  if (missingFromInv.length > 0) {
    issues.push(`Itens na PL ausentes na INV: ${missingFromInv.join(', ')}`);
  }

  if (inv.linesWithoutCode > 0 || pl.linesWithoutCode > 0) {
    warnings.push(
      `Linhas sem codigo de item (nao comparadas): INV=${inv.linesWithoutCode}, PL=${pl.linesWithoutCode}`,
    );
  }

  let qtyMismatches = 0;
  let qtyUnknown = 0;
  let descMismatches = 0;

  for (const [code, invItem] of inv.byCode.entries()) {
    const plItem = pl.byCode.get(code);
    if (!plItem) continue;

    if (
      invItem.quantity == null ||
      plItem.quantity == null ||
      invItem.quantityGaps > 0 ||
      plItem.quantityGaps > 0
    ) {
      qtyUnknown++;
      warnings.push(
        `Item ${code}: quantidade nao extraida em ${invItem.quantityGaps} linha(s) da INV e ${plItem.quantityGaps} linha(s) da PL — comparacao de quantidade nao realizada`,
      );
    } else if (invItem.quantity !== plItem.quantity) {
      qtyMismatches++;
      const invDetail =
        invItem.lines > 1 ? `${invItem.quantity} (${invItem.lines} linhas)` : `${invItem.quantity}`;
      const plDetail =
        plItem.lines > 1 ? `${plItem.quantity} (${plItem.lines} linhas)` : `${plItem.quantity}`;
      warnings.push(`Item ${code}: INV qtd=${invDetail}, PL qtd=${plDetail}`);
    }

    const invDesc = invItem.descriptions[0] ?? '';
    const plDesc = plItem.descriptions[0] ?? '';
    if (invDesc && plDesc && !descriptionsMatch(invDesc, plDesc)) {
      descMismatches++;
      warnings.push(`Item ${code}: descricao divergente ("${invDesc}" x "${plDesc}")`);
    }
  }

  const inventory = `${inv.byCode.size} codigos / ${inv.lineCount} linhas INV, ${pl.byCode.size} codigos / ${pl.lineCount} linhas PL`;

  if (missingFromPl.length > 0 || missingFromInv.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: inventory,
      actualValue: `${missingFromPl.length} ausentes na PL, ${missingFromInv.length} ausentes na INV`,
      documentsCompared: 'INV vs PL',
      message: issues.join('. ') + '.',
    };
  }

  if (qtyMismatches > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Todas as quantidades conferindo',
      actualValue: `${qtyMismatches} divergencias de qtd, ${qtyUnknown} sem quantidade extraida, ${descMismatches} divergencias de descricao`,
      documentsCompared: 'INV vs PL',
      message: `Quantidades dos itens divergem: ${warnings.join('; ')}.`,
    };
  }

  if (qtyUnknown > 0 || descMismatches > 0 || warnings.length > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Quantidades e descricoes conferindo',
      actualValue: `${qtyUnknown} item(ns) sem quantidade extraida, ${descMismatches} divergencias de descricao`,
      documentsCompared: 'INV vs PL',
      message: `${warnings.join('; ')}.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: inventory,
    actualValue: `${inv.byCode.size} itens conferidos (${inv.lineCount} linhas)`,
    documentsCompared: 'INV vs PL',
    message: `Todos os ${inv.byCode.size} itens (${inv.lineCount} linhas) conferem entre Invoice e Packing List.`,
  };
}
