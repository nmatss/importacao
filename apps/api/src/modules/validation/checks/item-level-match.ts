interface CheckInput {
  invoiceData?: Record<string, any>;
  packingListData?: Record<string, any>;
  blData?: Record<string, any>;
  processData?: Record<string, any>;
  followUpData?: Record<string, any>;
}

interface CheckResult {
  checkName: string;
  status: 'passed' | 'failed' | 'warning';
  expectedValue?: string;
  actualValue?: string;
  documentsCompared: string;
  message: string;
}

function fuzzyMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Simple similarity: check if at least 80% of shorter string chars are in the longer one
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length === 0) return false;
  let matches = 0;
  for (const char of shorter) {
    if (longer.includes(char)) matches++;
  }
  return matches / shorter.length >= 0.8;
}

export default function itemLevelMatch(input: CheckInput): CheckResult {
  const checkName = 'item-level-match';

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

  const issues: string[] = [];
  const warnings: string[] = [];

  // Build maps by itemCode
  const invMap = new Map<string, Record<string, any>>();
  for (const item of invItems) {
    const code = String(item.itemCode ?? item.code ?? '').trim();
    if (code) invMap.set(code, item);
  }

  const plMap = new Map<string, Record<string, any>>();
  for (const item of plItems) {
    const code = String(item.itemCode ?? item.code ?? '').trim();
    if (code) plMap.set(code, item);
  }

  // Items in INV but missing from PL
  const missingFromPl: string[] = [];
  for (const code of invMap.keys()) {
    if (!plMap.has(code)) {
      missingFromPl.push(code);
    }
  }

  // Items in PL but missing from INV
  const missingFromInv: string[] = [];
  for (const code of plMap.keys()) {
    if (!invMap.has(code)) {
      missingFromInv.push(code);
    }
  }

  if (missingFromPl.length > 0) {
    issues.push(`Itens na INV ausentes na PL: ${missingFromPl.join(', ')}`);
  }
  if (missingFromInv.length > 0) {
    issues.push(`Itens na PL ausentes na INV: ${missingFromInv.join(', ')}`);
  }

  // Compare matching items
  let qtyMismatches = 0;
  let descMismatches = 0;

  for (const [code, invItem] of invMap.entries()) {
    const plItem = plMap.get(code);
    if (!plItem) continue;

    // Compare quantities
    const invQty = Number(invItem.quantity ?? 0);
    const plQty = Number(plItem.quantity ?? 0);
    if (invQty !== plQty && !(isNaN(invQty) && isNaN(plQty))) {
      qtyMismatches++;
      warnings.push(`Item ${code}: INV qtd=${invQty}, PL qtd=${plQty}`);
    }

    // Compare descriptions (fuzzy)
    const invDesc = String(invItem.description ?? '');
    const plDesc = String(plItem.description ?? '');
    if (invDesc && plDesc && !fuzzyMatch(invDesc, plDesc)) {
      descMismatches++;
      warnings.push(`Item ${code}: descricao divergente`);
    }
  }

  // Determine status
  if (missingFromPl.length > 0 || missingFromInv.length > 0) {
    return {
      checkName,
      status: 'failed',
      expectedValue: `${invMap.size} itens INV, ${plMap.size} itens PL`,
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
      actualValue: `${qtyMismatches} divergencias de qtd, ${descMismatches} divergencias de descricao`,
      documentsCompared: 'INV vs PL',
      message: `Quantidades dos itens divergem: ${warnings.join('; ')}.`,
    };
  }

  if (descMismatches > 0) {
    return {
      checkName,
      status: 'warning',
      expectedValue: 'Todas as descricoes conferindo',
      actualValue: `${descMismatches} divergencias de descricao`,
      documentsCompared: 'INV vs PL',
      message: `${descMismatches} descricao(oes) do(s) item(ns) diverge(m) entre INV e PL.`,
    };
  }

  return {
    checkName,
    status: 'passed',
    expectedValue: `${invMap.size} itens`,
    actualValue: `${invMap.size} itens conferidos`,
    documentsCompared: 'INV vs PL',
    message: `Todos os ${invMap.size} itens conferem entre Invoice e Packing List.`,
  };
}
