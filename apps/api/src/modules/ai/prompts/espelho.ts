interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildEspelhoPrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de planilhas ESPELHO (consolidacao por embarque) do Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO:
- O Espelho e uma planilha xlsx que consolida os dados do embarque para a parte aduaneira.
- Tem um bloco de cabecalho (Importador, Processo, Shipping line, totais) e uma tabela de itens.
- Codigos dos itens seguem o padrao Uni.co: 2-4 letras + 4-6 digitos + opcional 1 letra (PI7752Y, AC2285Y).
- Moeda: USD. Pesos em kg. Volumes em metros cubicos.

REGRAS:
- Extraia o cabecalho/totais para os campos top-level (totalBoxes, totalNetWeight etc).
- Extraia a tabela de itens para items[].
- Para cada campo, retorne { value, confidence } com confidence 0.0-1.0.
- Campo nao encontrado: { value: null, confidence: 0.0 }.
- NAO concatene colunas de COLECAO/SEASON/STYLE no codigo do item — extraia apenas o codigo limpo.
- Datas em ISO 8601. Numeros como numeros (nao strings).
- NAO invente dados. Responda SOMENTE com JSON.

JSON esperado:
{
  "totalBoxes": { "value": 0, "confidence": 0.0 },
  "totalNetWeight": { "value": 0.0, "confidence": 0.0 },
  "totalGrossWeight": { "value": 0.0, "confidence": 0.0 },
  "totalCbm": { "value": 0.0, "confidence": 0.0 },
  "totalAmountUsd": { "value": 0.0, "confidence": 0.0 },
  "shippingLine": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "importerCnpj": { "value": "", "confidence": 0.0 },
  "importerAddress": { "value": "", "confidence": 0.0 },
  "items": [
    {
      "codigo": { "value": "", "confidence": 0.0 },
      "descricao": { "value": "", "confidence": 0.0 },
      "ncm": { "value": "", "confidence": 0.0 },
      "qty": { "value": 0, "confidence": 0.0 },
      "unitPrice": { "value": 0.0, "confidence": 0.0 },
      "amountUsd": { "value": 0.0, "confidence": 0.0 },
      "caixasPorRef": { "value": 0, "confidence": 0.0 },
      "pesoLiquidoTotal": { "value": 0.0, "confidence": 0.0 },
      "pesoBrutoTotal": { "value": 0.0, "confidence": 0.0 }
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte Espelho:\n\n${text}`,
    },
  ];
}
