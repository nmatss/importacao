import * as XLSX from 'xlsx';

interface PuketItem {
  itemCode: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  ncmCode: string | null;
  unitPrice: string | null;
  quantity: number | null;
  boxQuantity: number | null;
  netWeight: string | null;
  grossWeight: string | null;
  isFreeOfCharge: boolean | null;
  requiresLi: boolean | null;
  requiresCertification: boolean | null;
}

const HEADERS = [
  'Codigo',
  'Descricao',
  'Cor',
  'Tamanho',
  'NCM',
  'Preco Unit. (USD)',
  'Quantidade',
  'Total (USD)',
  'Caixas',
  'Peso Liq. (kg)',
  'Peso Bruto (kg)',
  'FOC',
  'LI',
  'Cert.',
];

export function generatePuketSheet(items: PuketItem[]): XLSX.WorkSheet {
  const rows: (string | number)[][] = [HEADERS];

  let totalQty = 0;
  let totalValue = 0;
  let totalBoxes = 0;
  let totalNetWeight = 0;
  let totalGrossWeight = 0;

  for (const item of items) {
    const price = Number(item.unitPrice) || 0;
    const qty = item.quantity ?? 0;
    const lineTotal = price * qty;
    const boxes = item.boxQuantity ?? 0;
    const netW = Number(item.netWeight) || 0;
    const grossW = Number(item.grossWeight) || 0;

    totalQty += qty;
    totalValue += lineTotal;
    totalBoxes += boxes;
    totalNetWeight += netW;
    totalGrossWeight += grossW;

    rows.push([
      item.itemCode ?? '',
      item.description ?? '',
      item.color ?? '',
      item.size ?? '',
      item.ncmCode ?? '',
      price,
      qty,
      Math.round(lineTotal * 100) / 100,
      boxes,
      Math.round(netW * 1000) / 1000,
      Math.round(grossW * 1000) / 1000,
      item.isFreeOfCharge ? 'Sim' : '',
      item.requiresLi ? 'Sim' : '',
      item.requiresCertification ? 'Sim' : '',
    ]);
  }

  // Totals row
  rows.push([
    '',
    '',
    '',
    '',
    'TOTAL',
    '',
    totalQty,
    Math.round(totalValue * 100) / 100,
    totalBoxes,
    Math.round(totalNetWeight * 1000) / 1000,
    Math.round(totalGrossWeight * 1000) / 1000,
    '',
    '',
    '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  ws['!cols'] = [
    { wch: 15 }, // Codigo
    { wch: 40 }, // Descricao
    { wch: 15 }, // Cor
    { wch: 10 }, // Tamanho
    { wch: 12 }, // NCM
    { wch: 16 }, // Preco Unit.
    { wch: 12 }, // Quantidade
    { wch: 14 }, // Total
    { wch: 8 },  // Caixas
    { wch: 12 }, // Peso Liq.
    { wch: 12 }, // Peso Bruto
    { wch: 6 },  // FOC
    { wch: 6 },  // LI
    { wch: 6 },  // Cert.
  ];

  // Store formatting metadata in sheet comments for downstream consumers
  const focItemRows: number[] = [];
  const liItemRows: number[] = [];
  items.forEach((item, idx) => {
    const rowNum = idx + 2; // 1-indexed, header is row 1
    if (item.isFreeOfCharge) focItemRows.push(rowNum);
    if (item.requiresLi) liItemRows.push(rowNum);
  });

  // Attach formatting info as custom property
  (ws as any).__formatting = {
    highlightRows: focItemRows,
    priorityRows: liItemRows,
  };

  return ws;
}
