/**
 * Build an espelho-style aggregate from flattened invoice + PL + BL data.
 * Pure / deterministic — no DB, no AI. Items are joined by normalized
 * item-code. Returns the same { summary, items } shape used by the manual
 * espelho path so downstream consumers (getComparison, frontend) work the
 * same way regardless of source.
 *
 * Nicolas (2026-05-21 meeting): "primeiro que ele não tá criando sozinho,
 * então ele não gera o exel" — espelho should auto-build when all 3 docs
 * are extracted, with no AI in the path.
 */
export function buildEspelhoFromAiData(
  inv: Record<string, any>,
  pl: Record<string, any>,
  bl: Record<string, any>,
): { summary: Record<string, any>; items: Array<Record<string, any>> } {
  const invItems = Array.isArray(inv.items) ? (inv.items as Array<Record<string, any>>) : [];
  const plItems = Array.isArray(pl.items) ? (pl.items as Array<Record<string, any>>) : [];

  const plByCode = new Map<string, Record<string, any>>();
  for (const item of plItems) {
    const code = item.itemCode ?? item.codigo;
    if (code)
      plByCode.set(
        String(code)
          .toUpperCase()
          .replace(/[\s\-./\\_]/g, ''),
        item,
      );
  }

  const items = invItems.map((it) => {
    const code = String(it.itemCode ?? it.codigo ?? '').trim();
    const norm = code.toUpperCase().replace(/[\s\-./\\_]/g, '');
    const plMatch = norm ? plByCode.get(norm) : undefined;
    return {
      codigo: code,
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
