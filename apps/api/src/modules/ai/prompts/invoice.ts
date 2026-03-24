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
- Se o documento contem "CNPJ", "NOTA FISCAL", "DANFE", "CTE", "FRETE", ou moeda "BRL/R$", este NAO e uma fatura comercial internacional. Retorne TODOS os campos com confidence: 0 e value: null.
- Fatura comercial internacional tem: "COMMERCIAL INVOICE", exportador estrangeiro, moeda USD/EUR/CNY.

Extraia os campos abaixo. Para cada campo, inclua confidence entre 0.0 e 1.0.

Responda com JSON estrito neste formato:
{
  "invoiceNumber": { "value": "", "confidence": 0.0 },
  "invoiceDate": { "value": "", "confidence": 0.0 },
  "exporterName": { "value": "", "confidence": 0.0 },
  "exporterAddress": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "importerAddress": { "value": "", "confidence": 0.0 },
  "incoterm": { "value": "", "confidence": 0.0 },
  "currency": { "value": "", "confidence": 0.0 },
  "portOfLoading": { "value": "", "confidence": 0.0 },
  "portOfDischarge": { "value": "", "confidence": 0.0 },
  "items": [
    {
      "itemCode": { "value": "", "confidence": 0.0 },
      "description": { "value": "", "confidence": 0.0 },
      "color": { "value": "", "confidence": 0.0 },
      "size": { "value": "", "confidence": 0.0 },
      "quantity": { "value": 0, "confidence": 0.0 },
      "unitPrice": { "value": 0.0, "confidence": 0.0 },
      "totalPrice": { "value": 0.0, "confidence": 0.0 },
      "ncmCode": { "value": "", "confidence": 0.0 },
      "unitType": { "value": "", "confidence": 0.0 },
      "manufacturer": { "value": "", "confidence": 0.0 }
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
- Valores numericos como numeros, nao strings
- Moeda em ISO 4217 (USD, EUR, CNY)
- Extraia TODOS os itens da tabela de produtos
- manufacturerName = fabrica (nao exportador/trading company)
- unitType = unidade de medida do item: "PCS", "PAR", "SET", "KG", "DZ", "UN"
- paymentTerms: "30% deposit, 70% balance within 30 days" → depositPercent: 30, balancePercent: 70, paymentDays: 30
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados da seguinte fatura comercial:\n\n${text}`,
    },
  ];
}
