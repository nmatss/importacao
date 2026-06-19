interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildInvoicePrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de FATURAS COMERCIAIS INTERNACIONAIS (Commercial Invoices) para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO DO NEGOCIO:
- Fornecedor principal: KIOM INDUSTRY CO., LTD (China)
- Importadores: Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda
- Moeda: USD (dolares americanos) — NUNCA BRL
- Incoterm: FOB (Free On Board) — pode aparecer tambem CIF ou CFR
- Portos de embarque: Shanghai, Ningbo, Xiamen, Shenzhen, Qingdao (China)
- Portos de destino: Navegantes, Itapoa, Itajai (Brasil)
- Produtos: roupas, calcados, acessorios, brinquedos, artigos de decoracao
- Unidades de medida: PAR (calcados), SET (conjuntos), PCS (pecas), KG, DZ (duzia)
- NCMs: codigos de 8 digitos brasileiros (ex: 6404.19.00, 9503.00.99)
- Pagamento tipico: 30% deposito, 70% saldo em 30-60 dias
- Marcas nos produtos: Puket, Imaginarium, Ludi (linha infantil)

REGRA CRITICA DE CLASSIFICACAO:
- Este prompt extrai FATURAS COMERCIAIS INTERNACIONAIS (Commercial Invoices) em USD/EUR/CNY destinadas a importadores brasileiros (Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda).
- TODA commercial invoice destinada ao Brasil menciona o CNPJ do importador — isso NAO e sinal de documento domestico. Nao rejeite por causa de "CNPJ".
- Rejeite APENAS quando o documento for claramente uma nota fiscal/documento fiscal domestico brasileiro. Sinal obrigatorio para rejeitar: o documento contem um dos termos ("DANFE", "NOTA FISCAL ELETRONICA", "NF-e", "CT-e", "CTE") E a moeda principal e BRL ou "R$".
- Se rejeitar, retorne TODOS os campos com confidence:0 e value:null.
- Exemplo POSITIVO (deve extrair): "COMMERCIAL INVOICE ... KIOM GLOBAL LIMITED ... USD ... IM0712602NB ... UNI.CO COMERCIO S/A CNPJ: 00.399.603/0006-12".

Extraia os campos abaixo. Para cada campo, inclua confidence entre 0.0 e 1.0.

Responda com JSON estrito neste formato:
{
	  "invoiceNumber": { "value": "", "confidence": 0.0 },
	  "invoiceDate": { "value": "", "confidence": 0.0 },
	  "shipmentDate": { "value": "", "confidence": 0.0 },
	  "etd": { "value": "", "confidence": 0.0 },
	  "shippedOnBoardDate": { "value": "", "confidence": 0.0 },
	  "exporterName": { "value": "", "confidence": 0.0 },
  "exporterAddress": { "value": "", "confidence": 0.0 },
  "exporterTaxId": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "importerAddress": { "value": "", "confidence": 0.0 },
  "importerCnpj": { "value": "", "confidence": 0.0 },
  "incoterm": { "value": "", "confidence": 0.0 },
  "currency": { "value": "", "confidence": 0.0 },
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
	      "unitPrice": { "value": 0.0, "confidence": 0.0 },
	      "totalPrice": { "value": 0.0, "confidence": 0.0 },
	      "netWeight": { "value": 0.0, "confidence": 0.0 },
	      "grossWeight": { "value": 0.0, "confidence": 0.0 },
	      "ncmCode": { "value": "", "confidence": 0.0 },
      "unitType": { "value": "", "confidence": 0.0 },
      "manufacturer": { "value": "", "confidence": 0.0 },
      "isFreeOfCharge": { "value": false, "confidence": 0.0 }
    }
  ],
  "manufacturerName": { "value": "", "confidence": 0.0 },
  "manufacturerAddress": { "value": "", "confidence": 0.0 },
  "paymentTerms": { "value": { "depositPercent": 0, "balancePercent": 0, "paymentDays": 0, "description": "" }, "confidence": 0.0 },
  "totalFobValue": { "value": 0.0, "confidence": 0.0 },
  "totalBoxes": { "value": 0, "confidence": 0.0 },
  "totalNetWeight": { "value": 0.0, "confidence": 0.0 },
  "totalGrossWeight": { "value": 0.0, "confidence": 0.0 },
  "totalCbm": { "value": 0.0, "confidence": 0.0 }
}

REGRAS:
- Campo nao encontrado → value: null, confidence: 0.0
	- Datas em ISO 8601 (YYYY-MM-DD)
	- invoiceDate = data de emissao da fatura. shipmentDate/etd/shippedOnBoardDate = datas logisticas de embarque quando impressas como "shipment", "ETD", "shipped/on board" ou equivalentes. Nao copie invoiceDate para esses campos se o documento nao indicar embarque.
	- Valores numericos como numeros, nao strings
- Moeda em ISO 4217 (USD, EUR, CNY)
- Extraia TODOS os itens da tabela de produtos
- manufacturerName = fabrica (nao exportador/trading company)
- unitType = unidade de medida do item: "PCS", "PAR", "SET", "KG", "DZ", "UN"
- paymentTerms: "30% deposit, 70% balance within 30 days" → depositPercent: 30, balancePercent: 70, paymentDays: 30
- itemCode: somente o codigo real do item. NAO inclua palavras que descrevem EMBALAGEM ("WHITE BOX", "BROWN BOX", "POLYBAG", "POLY BAG", "GIFT BOX", "COLOR BOX") como prefixo do codigo. Se o layout do PDF colocar a coluna de embalagem colada ao codigo, separe os valores.
- Se todos os item codes comecarem com a MESMA letra isolada (ex.: todos comecam com "W"), isso provavelmente e ruido da coluna ao lado — retorne os codigos sem esse prefixo.
- NUNCA concatene valores de outras colunas no itemCode. Colunas comuns coladas ao codigo em PDFs com layout compacto: COLECAO/COLLECTION/SEASON/TEMP, MARCA/BRAND, ESTILO/STYLE, REFERENCIA do fornecedor. Exemplo: linha "FALL/24 PI7752Y BLOUSE..." -> itemCode="PI7752Y" (NAO "FALL/24 PI7752Y"). O codigo do item segue padrao tipico: 2 letras + 4-6 digitos + opcional 1 letra (PI7752Y, AC2285Y, PKT123).
- ean: codigo de barras EAN/GTIN do item (8, 12, 13 ou 14 digitos), SOMENTE quando impresso no documento (colunas tipicas: EAN, BARCODE, BAR CODE, GTIN, UPC). NUNCA invente, complete ou calcule um EAN; se o codigo de barras nao estiver impresso no documento, retorne value: null, confidence: 0.0 para o campo ean.
- exporterTaxId: VAT/Tax ID do exportador (fora do Brasil, ex.: registro chines de 18 digitos, EIN, etc.). importerCnpj: CNPJ brasileiro do importador no formato 00.000.000/0000-00 quando possivel.
- exporterName = empresa VENDEDORA/exportadora que emite a fatura (trading company ou fabrica, ex.: "KIOM GLOBAL LIMITED"). NUNCA use o nome do NAVIO nem da companhia maritima/armador. Nomes como "COSCO", "COSCO SHIPPING ARGENTINA", "MAERSK", "MSC", "HAPAG-LLOYD", "EVERGREEN", "CMA CGM", "ONE LINE", "HMM", "OOCL", ou qualquer "... SHIPPING LINE" / "... CONTAINER LINE" / "... MARITIME" sao do TRANSPORTE (pertencem ao Bill of Lading), NAO da fatura. Se o unico candidato a exportador for um nome de navio/armador, retorne exporterName com value:null, confidence:0.
- isFreeOfCharge: TRUE quando o item e gratuito — sinais: unitPrice = 0, descricao contem "FREE OF CHARGE", "FOC", "complimentary", "sample", "amostra", "brinde". Quando true, o item NAO entra na soma do totalFobValue declarado.
	- SEPARE quantidade de faturamento: quantity = NUMERO de unidades (QTY/QUANTITY/PCS/PAR/SET); unitPrice e totalPrice = VALORES em dinheiro (UNIT PRICE/AMOUNT/TOTAL/USD). NUNCA troque os dois: nao coloque preco/amount em quantity nem quantidade em unitPrice/totalPrice. Em layout compacto, use o cabecalho da coluna para decidir.
	- netWeight/grossWeight por item: preencha apenas quando houver colunas de peso liquido/bruto por item na Invoice; pesos sempre em KG. Se a Invoice nao trouxer peso por item, retorne null/confidence 0 nesses campos.
	- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados da seguinte fatura comercial:\n\n${text}`,
    },
  ];
}
