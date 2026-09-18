/** Conservative fallback for the labelled Fenicia draft layout. References are
 * preserved verbatim, including colour/size suffixes; catalogue IDs never stand
 * in for commercial references. An incomplete table is left for review. */
export function parseDraftDuimpItems(text: string) {
  if (!/FENICIA\s+ASSESSORIA/i.test(text) || !/DUIMP/i.test(text)) return null;
  const expected = Number(text.match(/N[º°o]\s*itens:\s*(\d+)/i)?.[1]);
  if (!Number.isSafeInteger(expected) || expected < 1) return null;
  const sections = [...text.matchAll(/^\s*(Adição|Item)\s+(\d+)\s*$/gm)];
  let ncm: string | null = null;
  const items = [];
  const cf = <T>(value: T | null) => ({ value, confidence: value == null ? 0 : 0.8 });
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    const body = text.slice(section.index! + section[0].length, sections[index + 1]?.index);
    if (section[1] === 'Adição') {
      ncm = body.match(/\bNCM:\s*(\d{4}\.\d{2}\.\d{2})\b/)?.[1] ?? null;
      continue;
    }
    const references = [...body.matchAll(/\bREF:\s*([A-Z0-9][A-Z0-9./-]*)(?=[;\s])/gi)];
    const detail = body.match(/Unidade COM\s+QTD COM[^\n]*\n([^\n]+)/i);
    if (references.length !== 1 || !detail || !ncm) return null;
    // Columns are separated by layout whitespace. In particular the statistic
    // quantity can be kilograms while the commercial quantity is units.
    const columns = detail[1].trim().split(/\s{2,}/);
    const unit = columns[2];
    const rawQuantity = columns[3];
    if (!unit || !rawQuantity || !/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(rawQuantity))
      return null;
    const quantity = Number(rawQuantity.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    const itemCode = references[0][1].replace(/\.$/, '');
    items.push({
      itemCode: cf(itemCode),
      quantity: cf(quantity),
      unitType: cf(unit),
      ncmCode: cf(ncm),
    });
  }
  return items.length === expected ? items : null;
}
