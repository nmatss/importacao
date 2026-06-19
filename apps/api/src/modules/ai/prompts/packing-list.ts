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

REGRA CRITICA DE CLASSIFICACAO:
- Este prompt extrai PACKING LISTS internacionais (idioma ingles ou bilingue) destinadas a importadores brasileiros (Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda).
- TODA packing list destinada ao Brasil menciona o CNPJ do importador — isso NAO e sinal de documento domestico. Nao rejeite por causa de "CNPJ".
- Rejeite APENAS quando o documento for uma nota fiscal/romaneio brasileiro domestico. Sinal obrigatorio: o documento contem um dos termos ("DANFE", "NOTA FISCAL ELETRONICA", "NF-e", "CT-e", "CTE") E a moeda principal e BRL/R$.
- Packing List internacional tem: "PACKING LIST", exportador estrangeiro, pesos em KG.

REGRA CRITICA — CUBAGEM vs CAIXAS:
- totalBoxes = NUMERO INTEIRO de caixas/cartons/volumes/packages (rótulos tipicos: "CARTON", "CARTONS", "QTY CARTONS", "BOXES", "VOLUMES", "PACKAGES", "TOTAL PACKAGES"). Exemplo: "QTY CARTONS 314" → totalBoxes=314.
- totalCbm = VOLUME EM METROS CUBICOS, decimal (rótulos tipicos: "CBM", "M3", "M³", "CUBIC METERS", "VOLUME (CBM)", "TOTAL CBM"). Exemplo: "TOTAL CBM 21.557" → totalCbm=21.557.
- Nunca confunda os dois. Se o mesmo texto aparecer em colunas proximas (muito comum em PDFs com layout compacto), use o rotulo para decidir.
- totalBoxes DEVE ser inteiro. totalCbm DEVE ser decimal.

REGRA CRITICA — QUANTIDADE vs FATURAMENTO:
- O Packing List NAO contem precos nem valores monetarios. Ele descreve UNIDADES e PESOS, nunca dinheiro.
- quantity = NUMERO de unidades (PCS/PAR/SET/DZ/etc) do item. NUNCA coloque um valor monetario em quantity.
- IGNORE qualquer coluna de PRECO/VALOR mesmo que apareça no documento: "UNIT PRICE", "AMOUNT", "TOTAL", "FOB", "VALUE", "USD", "PRICE", "$". Esses campos pertencem a Commercial Invoice (INV), NAO ao Packing List.
- Em PDFs que combinam INV+PL ou com colunas coladas, use o cabecalho para separar QUANTIDADE (QTY/QUANTITY/PCS) de FATURAMENTO (AMOUNT/USD/PRICE). Se a coluna for de dinheiro, descarte — nao a leia como quantity.
- Sinal de erro a evitar: quantity com casas decimais que parecem preço (ex: 25.50) — quantidade de PCS costuma ser inteiro.

Extraia os campos abaixo com confidence 0.0-1.0.

Responda com JSON estrito:
{
	  "packingListNumber": { "value": "", "confidence": 0.0 },
	  "invoiceNumber": { "value": "", "confidence": 0.0 },
	  "date": { "value": "", "confidence": 0.0 },
	  "shipmentDate": { "value": "", "confidence": 0.0 },
	  "etd": { "value": "", "confidence": 0.0 },
	  "shippedOnBoardDate": { "value": "", "confidence": 0.0 },
	  "exporterName": { "value": "", "confidence": 0.0 },
  "exporterAddress": { "value": "", "confidence": 0.0 },
  "exporterTaxId": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "importerAddress": { "value": "", "confidence": 0.0 },
  "importerCnpj": { "value": "", "confidence": 0.0 },
  "portOfLoading": { "value": "", "confidence": 0.0 },
  "portOfDischarge": { "value": "", "confidence": 0.0 },
  "items": [
    {
      "itemCode": { "value": "", "confidence": 0.0 },
      "ean": { "value": "", "confidence": 0.0 },
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
	- date = data de emissao do Packing List. shipmentDate/etd/shippedOnBoardDate = datas logisticas de embarque quando impressas como "shipment", "ETD", "shipped/on board" ou equivalentes. Nao copie date para esses campos se o documento nao indicar embarque.
	- Pesos SEMPRE em quilogramas (KG). Se o doc mostra tons, converta para KG.
- CBM em metros cubicos
- Extraia TODOS os itens da tabela
- itemCode: somente o codigo real do item. NAO inclua palavras que descrevem EMBALAGEM ("WHITE BOX", "BROWN BOX", "POLYBAG", "POLY BAG", "GIFT BOX", "COLOR BOX") como prefixo do codigo. Se o layout do PDF colocar a coluna de embalagem colada ao codigo, separe os valores.
- Se todos os item codes comecarem com a MESMA letra isolada (ex.: todos comecam com "W"), isso provavelmente e ruido da coluna ao lado — retorne os codigos sem esse prefixo.
- ean: codigo de barras EAN/GTIN do item (8, 12, 13 ou 14 digitos), SOMENTE quando impresso no documento (colunas tipicas: EAN, BARCODE, BAR CODE, GTIN, UPC). NUNCA invente, complete ou calcule um EAN; se o codigo de barras nao estiver impresso no documento, retorne value: null, confidence: 0.0 para o campo ean.
- NUNCA concatene valores de outras colunas no itemCode. Colunas comuns coladas ao codigo em PDFs com layout compacto: COLECAO/COLLECTION/SEASON/TEMP, MARCA/BRAND, ESTILO/STYLE, REFERENCIA do fornecedor. Exemplo: linha "FALL/24 PI7752Y BLOUSE..." -> itemCode="PI7752Y" (NAO "FALL/24 PI7752Y"). O codigo do item segue padrao tipico: 2 letras + 4-6 digitos + opcional 1 letra (PI7752Y, AC2285Y, PKT123).
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte Packing List:\n\n${text}`,
    },
  ];
}
