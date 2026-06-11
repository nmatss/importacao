/**
 * Build an espelho-style aggregate from flattened invoice + PL + BL data.
 * Pure / deterministic — no DB, no AI. Items are joined by EAN when both
 * sides carry a valid one (anchored join — backlog #9), falling back to the
 * original normalized item-code join. Returns the same { summary, items }
 * shape used by the manual espelho path so downstream consumers
 * (getComparison, frontend) work the same way regardless of source.
 *
 * Nicolas (2026-05-21 meeting): "primeiro que ele não tá criando sozinho,
 * então ele não gera o exel" — espelho should auto-build when all 3 docs
 * are extracted, with no AI in the path.
 *
 * EAN groundwork (NO XLSX layout change — templates stay untouched):
 * - join precedence: valid EAN on both sides > normalized itemCode;
 * - EANs failing the GTIN mod-10 check digit are treated as absent;
 * - items missing a document EAN are enriched from the Base EAN KB
 *   (ai/knowledge/ean.json) when the lookup is unambiguous, with the origin
 *   recorded in `eanSource: 'document' | 'kb'`.
 */
import { normalizeGtin } from '../../ai/harness/format.js';
import {
  getDefaultEanIndex,
  lookupEan,
  normalizeItemCode,
  type EanIndex,
} from '../../espelhos/ean-lookup.js';

export function buildEspelhoFromAiData(
  inv: Record<string, any>,
  pl: Record<string, any>,
  bl: Record<string, any>,
  opts: { eanIndex?: EanIndex } = {},
): { summary: Record<string, any>; items: Array<Record<string, any>> } {
  const invItems = Array.isArray(inv.items) ? (inv.items as Array<Record<string, any>>) : [];
  const plItems = Array.isArray(pl.items) ? (pl.items as Array<Record<string, any>>) : [];
  const eanIndex = opts.eanIndex ?? getDefaultEanIndex();

  const plByEan = new Map<string, Record<string, any>>();
  const plByCode = new Map<string, Record<string, any>>();
  for (const item of plItems) {
    const ean = normalizeGtin(item.ean);
    if (ean && !plByEan.has(ean)) plByEan.set(ean, item);
    const code = normalizeItemCode(item.itemCode ?? item.codigo);
    if (code && !plByCode.has(code)) plByCode.set(code, item);
  }

  const items = invItems.map((it) => {
    const code = String(it.itemCode ?? it.codigo ?? '').trim();
    const norm = normalizeItemCode(code);
    const invEan = normalizeGtin(it.ean);
    // Join precedence: EAN (when the invoice side has a valid one and the PL
    // indexed it) > normalized item-code (original behavior, kept as-is).
    const plMatch =
      (invEan ? plByEan.get(invEan) : undefined) ?? (norm ? plByCode.get(norm) : undefined);

    // EAN of the espelho line: document first (INV, then matched PL row),
    // then Base EAN KB keyed by item code — never invented.
    const docEan = invEan ?? normalizeGtin(plMatch?.ean);
    const kbEan = docEan
      ? null
      : lookupEan(eanIndex, code, {
          color: it.color ?? plMatch?.color,
          size: it.size ?? plMatch?.size,
        });
    const ean = docEan ?? kbEan;

    return {
      codigo: code,
      ean,
      eanSource: docEan ? 'document' : kbEan ? 'kb' : null,
      descricao: it.description ?? it.descricao ?? '',
      ncm: it.ncmCode ?? it.ncm ?? null,
      qty: it.quantity ?? plMatch?.quantity ?? null,
      unitPrice: it.unitPrice ?? null,
      amountUsd: it.totalPrice ?? null,
      caixasPorRef: plMatch?.boxQuantity ?? it.boxQuantity ?? null,
      pesoLiquidoTotal: plMatch?.netWeight ?? it.netWeight ?? null,
      pesoBrutoTotal: plMatch?.grossWeight ?? it.grossWeight ?? null,
      color: it.color ?? plMatch?.color ?? null,
      size: it.size ?? plMatch?.size ?? null,
    };
  });

  const summary = {
    totalBoxes: pl.totalBoxes ?? inv.totalBoxes ?? null,
    totalNetWeight: pl.totalNetWeight ?? inv.totalNetWeight ?? null,
    totalGrossWeight: pl.totalGrossWeight ?? bl.totalGrossWeight ?? inv.totalGrossWeight ?? null,
    totalCbm: pl.totalCbm ?? bl.totalCbm ?? inv.totalCbm ?? null,
    totalAmountUsd: inv.totalFobValue ?? null,
    shippingLine: bl.shipper ?? bl.shipperName ?? null,
    vesselName: bl.vesselName ?? null,
    containerNumber: bl.containerNumber ?? null,
    blNumber: bl.blNumber ?? null,
    importerName: inv.importerName ?? pl.importerName ?? null,
    importerCnpj: inv.importerCnpj ?? pl.importerCnpj ?? null,
    importerAddress: inv.importerAddress ?? pl.importerAddress ?? null,
    generatedAt: new Date().toISOString(),
    generatedBy: 'auto_deterministic',
  };

  return { summary, items };
}
