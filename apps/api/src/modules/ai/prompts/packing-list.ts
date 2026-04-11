interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildPackingListPrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de PACKING LISTS (listas de embalagem) de importacao internacional para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO DO NEGOCIO:
- Fornecedor principal: KIOM INDUSTRY CO., LTD (China)
- Importadores: Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda
- Produtos: roupas, calcados, acessorios, brinquedos — embalados em caixas (cartons)
- Pesos em quilogramas (KG), volumes em metros cubicos (CBM)
- Cada item tem: codigo, descricao, cor, tamanho, quantidade, caixas, pesos
- Packing Lists tipicamente acompanham a Commercial Invoice e referenciam o numero da mesma
- Marcas: Puket, Imaginarium, Ludi

REGRA CRITICA:
- Se o documento for uma nota fiscal domestica (DANFE, CNPJ, BRL), retorne TODOS os campos com confidence: 0 e value: null.
- Packing List internacional tem: "PACKING LIST", exportador estrangeiro, pesos em KG.

REGRA CRITICA — CUBAGEM vs CAIXAS:
- totalBoxes = NUMERO INTEIRO de caixas/cartons/volumes/packages (rótulos tipicos: "CARTON", "CARTONS", "QTY CARTONS", "BOXES", "VOLUMES", "PACKAGES", "TOTAL PACKAGES"). Exemplo: "QTY CARTONS 314" → totalBoxes=314.
- totalCbm = VOLUME EM METROS CUBICOS, decimal (rótulos tipicos: "CBM", "M3", "M³", "CUBIC METERS", "VOLUME (CBM)", "TOTAL CBM"). Exemplo: "TOTAL CBM 21.557" → totalCbm=21.557.
- Nunca confunda os dois. Se o mesmo texto aparecer em colunas proximas (muito comum em PDFs com layout compacto), use o rotulo para decidir.
- totalBoxes DEVE ser inteiro. totalCbm DEVE ser decimal.

Extraia os campos abaixo com confidence 0.0-1.0.

Responda com JSON estrito:
{
  "packingListNumber": { "value": "", "confidence": 0.0 },
  "invoiceNumber": { "value": "", "confidence": 0.0 },
  "date": { "value": "", "confidence": 0.0 },
  "exporterName": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "items": [
    {
      "itemCode": { "value": "", "confidence": 0.0 },
      "description": { "value": "", "confidence": 0.0 },
      "color": { "value": "", "confidence": 0.0 },
      "size": { "value": "", "confidence": 0.0 },
      "quantity": { "value": 0, "confidence": 0.0 },
      "boxQuantity": { "value": 0, "confidence": 0.0 },
      "netWeight": { "value": 0.0, "confidence": 0.0 },
      "grossWeight": { "value": 0.0, "confidence": 0.0 }
    }
  ],
  "totalBoxes": { "value": 0, "confidence": 0.0 },
  "totalNetWeight": { "value": 0.0, "confidence": 0.0 },
  "totalGrossWeight": { "value": 0.0, "confidence": 0.0 },
  "totalCbm": { "value": 0.0, "confidence": 0.0 }
}

REGRAS:
- Campo nao encontrado → value: null, confidence: 0.0
- Datas em ISO 8601 (YYYY-MM-DD)
- Pesos SEMPRE em quilogramas (KG). Se o doc mostra tons, converta para KG.
- CBM em metros cubicos
- Extraia TODOS os itens da tabela
- itemCode: somente o codigo real do item. NAO inclua palavras que descrevem EMBALAGEM ("WHITE BOX", "BROWN BOX", "POLYBAG", "POLY BAG", "GIFT BOX", "COLOR BOX") como prefixo do codigo. Se o layout do PDF colocar a coluna de embalagem colada ao codigo, separe os valores.
- Se todos os item codes comecarem com a MESMA letra isolada (ex.: todos comecam com "W"), isso provavelmente e ruido da coluna ao lado — retorne os codigos sem esse prefixo.
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte Packing List:\n\n${text}`,
    },
  ];
}
