import * as XLSX from 'xlsx';

interface ImaginariumItem {
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
  'Ref.',
  'Descricao do Produto',
  'Cor/Acabamento',
  'Tam.',
  'NCM',
  'Vlr Unit. USD',
  'Qtd.',
  'Vlr Total USD',
  'N Caixas',
  'Peso Liq.',
  'Peso Bruto',
  'FOC',
  'Req. LI',
  'Req. Cert.',
];

export function generateImaginariumSheet(items: ImaginariumItem[]): XLSX.WorkSheet {
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
    { wch: 15 }, // Ref.
    { wch: 40 }, // Descricao do Produto
    { wch: 18 }, // Cor/Acabamento
    { wch: 8 },  // Tam.
    { wch: 12 }, // NCM
    { wch: 14 }, // Vlr Unit.
    { wch: 8 },  // Qtd.
    { wch: 14 }, // Vlr Total
    { wch: 10 }, // N Caixas
    { wch: 12 }, // Peso Liq.
    { wch: 12 }, // Peso Bruto
    { wch: 6 },  // FOC
    { wch: 8 },  // Req. LI
    { wch: 9 },  // Req. Cert.
  ];

  // Store formatting metadata
  const focItemRows: number[] = [];
  const liItemRows: number[] = [];
  items.forEach((item, idx) => {
    const rowNum = idx + 2;
    if (item.isFreeOfCharge) focItemRows.push(rowNum);
    if (item.requiresLi) liItemRows.push(rowNum);
  });

  (ws as any).__formatting = {
    highlightRows: focItemRows,
    priorityRows: liItemRows,
  };

  return ws;
}
