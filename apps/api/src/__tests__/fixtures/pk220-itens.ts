/**
 * Os 14 pares REAIS de codigo de item do processo PK2202608SZ (PK220), lidos
 * por SELECT em `documents.ai_parsed_data` dos documentos 167 (invoice) e 168
 * (packing list) em producao, em 11/09/2026.
 *
 * Por que os codigos ficam no repositorio: eles sao a prova do defeito. A IA
 * concatenou as colunas PI / COLLECTION / ITEM CODE do layout Puket numa
 * celula so ('PK2062607BXIS27' + '050404509'), e as vezes perdeu o zero a
 * esquerda ('...S2750404638'). O SKU de verdade esta entre colchetes na
 * descricao. Nenhum documento real e commitado: so os codigos e uma descricao
 * abreviada, o suficiente para o casamento ser exercitado de ponta a ponta.
 */
export interface FixtureItem {
  itemCode: string;
  description: string;
  quantity: number;
}

export const PK220_INVOICE_ITEMS: FixtureItem[] = [
  {
    itemCode: 'PK2062607BXIS2750404509',
    description: '[050404509] BACKPACK KIDS A',
    quantity: 1232,
  },
  {
    itemCode: 'PK2062607BXIS2750404510',
    description: '[050404510] LUNCH BAG KIDS A',
    quantity: 1301,
  },
  {
    itemCode: 'PK2072609AXIHS2750404060',
    description: '[050404060] BACKPACK KIDS B',
    quantity: 950,
  },
  {
    itemCode: 'PK2072609AXIHS2750404065',
    description: '[050404065] LUNCH BAG KIDS B',
    quantity: 3938,
  },
  {
    itemCode: 'PK2072609AXIHS2750404290',
    description: '[050404290] PENCIL CASE BIG A',
    quantity: 2350,
  },
  {
    itemCode: 'PK2072609AXIHS2750404309',
    description: '[050404309] PENCIL CASE BIG B',
    quantity: 1836,
  },
  {
    itemCode: 'PK2072609AXIHS2750404428',
    description: '[050404428] LUNCH BAG KIDS C',
    quantity: 1760,
  },
  {
    itemCode: 'PK2072609AXIHS2750404509',
    description: '[050404509] BACKPACK KIDS A',
    quantity: 2476,
  },
  {
    itemCode: 'PK2072609AXIHS2750404510',
    description: '[050404510] LUNCH BAG KIDS A',
    quantity: 2407,
  },
  {
    itemCode: 'PK2072609AXIHS2750404576',
    description: '[050404576] PENCIL CASE BIG C',
    quantity: 1755,
  },
  {
    itemCode: 'PK2102606BSZS27050404637',
    description: '[050404637] STICKER PINK',
    quantity: 32362,
  },
  {
    itemCode: 'PK2102606BSZS2750404638',
    description: '[050404638] STICKER TIFFANY',
    quantity: 20594,
  },
  { itemCode: 'PK2102606BSZS2750404639', description: '[050404639] STICKER TEAL', quantity: 17652 },
  {
    itemCode: 'PK2272607BXIHS2727.01.0007',
    description: '[27.01.0007] STICKER YELLOW',
    quantity: 2,
  },
];

export const PK220_PACKING_LIST_ITEMS: FixtureItem[] = [
  { itemCode: '050404509', description: 'BACKPACK KIDS A', quantity: 1232 },
  { itemCode: '050404510', description: 'LUNCH BAG KIDS A', quantity: 1301 },
  { itemCode: '050404060', description: 'BACKPACK KIDS B', quantity: 950 },
  { itemCode: '050404065', description: 'LUNCH BAG KIDS B', quantity: 3938 },
  { itemCode: '050404290', description: 'PENCIL CASE BIG A', quantity: 2350 },
  { itemCode: '050404309', description: 'PENCIL CASE BIG B', quantity: 1836 },
  { itemCode: '050404428', description: 'LUNCH BAG KIDS C', quantity: 1760 },
  { itemCode: '050404509', description: 'BACKPACK KIDS A', quantity: 2476 },
  { itemCode: '050404510', description: 'LUNCH BAG KIDS A', quantity: 2407 },
  { itemCode: '050404576', description: 'PENCIL CASE BIG C', quantity: 1755 },
  { itemCode: '050404637', description: 'STICKER PINK', quantity: 32362 },
  { itemCode: '050404638', description: 'STICKER TIFFANY', quantity: 20594 },
  { itemCode: '050404639', description: 'STICKER TEAL', quantity: 17652 },
  { itemCode: '27.01.0007', description: 'STICKER YELLOW', quantity: 2 },
];

/**
 * Espelho SINTETICO com a estrutura do documento 163 (o unico espelho de
 * operador em producao): `summary` + `items` com as chaves reais da planilha.
 * Nenhum dado de cliente — so a forma.
 */
export function espelhoSinteticoPk220() {
  return {
    sheetName: 'Espelho',
    headerRowIndex: 3,
    rawRowCount: PK220_PACKING_LIST_ITEMS.length,
    summary: {
      importerName: 'IMPORTADORA EXEMPLO S.A.',
      importerCnpj: '11.222.333/0001-81',
      importerAddress: 'CNPJ: 11.222.333/0001-81 RUA EXEMPLO, 100',
      shippingLine: 'EXEMPLO LINES',
      totalAmountUsd: 1000,
      totalBoxes: 10,
      totalPieces: PK220_PACKING_LIST_ITEMS.reduce((total, item) => total + item.quantity, 0),
      totalCbm: 12.5,
      totalNetWeight: 100,
      totalGrossWeight: 120,
    },
    items: PK220_PACKING_LIST_ITEMS.map((item, index) => ({
      codigo: item.itemCode,
      nomeProduto: item.description,
      ncm: '42029200',
      ean13: `789${String(index).padStart(10, '0')}`,
      qty: item.quantity,
      unitPrice: 1,
      amountUsd: item.quantity,
      caixasPorRef: 1,
      pesoUnitario: 0.1,
      pesoLiquidoTotal: item.quantity * 0.1,
      pesoBrutoTotal: item.quantity * 0.12,
      gwNt: 1.2,
      cor: 'AZUL',
      tamanho: 'U',
      genero: 'KIDS',
      composicao: 'NYLON',
      fornecedor: 'FORNECEDOR EXEMPLO',
      codFabricante: 'FAB-1',
      processo: 'PK2202608SZ',
    })),
  };
}
