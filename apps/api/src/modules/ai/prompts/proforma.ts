interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildProformaPrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de PROFORMA INVOICES (faturas pro-forma / estimativas pre-embarque) para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO:
- A Proforma Invoice e uma estimativa emitida ANTES do embarque, usada para abertura de processo, negociacao e pagamento de deposito.
- Valores, quantidades e itens podem ainda mudar antes da emissao da Commercial Invoice definitiva.
- Cada Proforma referencia um numero de PI (Proforma Invoice number) que e o link com a planilha Pre-Cons.
- Fornecedor tipico: KIOM INDUSTRY CO., LTD (China). Importadores: Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda.

REGRA CRITICA DE CLASSIFICACAO:
- Este prompt extrai PROFORMA INVOICES (sinal: titulo "PROFORMA INVOICE" / "PRO-FORMA INVOICE" ou numero comecando com PI seguido de digitos).
- Se o documento for uma Commercial Invoice definitiva (sem a palavra "proforma"), retorne TODOS os campos com confidence:0 e value:null para indicar misclassificacao.

Extraia os campos abaixo com confidence 0.0-1.0. Responda JSON estrito:
{
  "piNumber": { "value": "", "confidence": 0.0 },
  "invoiceNumber": { "value": "", "confidence": 0.0 },
  "invoiceDate": { "value": "", "confidence": 0.0 },
  "validUntil": { "value": "", "confidence": 0.0 },
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
      "description": { "value": "", "confidence": 0.0 },
      "color": { "value": "", "confidence": 0.0 },
      "size": { "value": "", "confidence": 0.0 },
      "quantity": { "value": 0, "confidence": 0.0 },
      "unitPrice": { "value": 0.0, "confidence": 0.0 },
      "totalPrice": { "value": 0.0, "confidence": 0.0 },
      "ncmCode": { "value": "", "confidence": 0.0 },
      "unitType": { "value": "", "confidence": 0.0 },
      "isFreeOfCharge": { "value": false, "confidence": 0.0 }
    }
  ],
  "paymentTerms": { "value": { "depositPercent": 0, "balancePercent": 0, "paymentDays": 0, "description": "" }, "confidence": 0.0 },
  "totalFobValue": { "value": 0.0, "confidence": 0.0 },
  "totalBoxes": { "value": 0, "confidence": 0.0 },
  "totalNetWeight": { "value": 0.0, "confidence": 0.0 },
  "totalGrossWeight": { "value": 0.0, "confidence": 0.0 },
  "totalCbm": { "value": 0.0, "confidence": 0.0 }
}

REGRAS:
- piNumber: numero da Proforma Invoice (ex.: PI001, PI-2024-042, PIK10056). Importante: e a chave de ligacao com a planilha Pre-Cons.
- validUntil: data de validade da cotacao (se houver). ISO 8601 (YYYY-MM-DD).
- isFreeOfCharge: TRUE quando unitPrice = 0 ou descricao contem "FOC", "FREE OF CHARGE", "sample", "amostra", "brinde".
- Datas em ISO 8601. Numeros como numeros (nao strings). Moeda em ISO 4217.
- Campo nao encontrado → value: null, confidence: 0.0.
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados desta Proforma Invoice:\n\n${text}`,
    },
  ];
}
