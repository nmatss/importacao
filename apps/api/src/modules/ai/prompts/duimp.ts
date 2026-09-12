type DuimpDocumentType = 'draft_duimp' | 'duimp';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildDUIMPPrompt(
  text: string,
  documentType: DuimpDocumentType = 'duimp',
): OpenRouterMessage[] {
  const label = documentType === 'draft_duimp' ? 'Draft/Minuta DUIMP' : 'DUIMP final';

  return [
    {
      role: 'system',
      content: `Voce e especialista em registro aduaneiro brasileiro. Extraia SOMENTE dados impressos em um ${label} (Declaracao Unica de Importacao).

REGRAS DE LEITURA:
- Nunca invente, calcule ou complete campos ausentes. Draft/Minuta pode nao conter canal ou data de desembaraco.
- customsValue = somente "Valor Aduaneiro" do registro. Nao use FOB, frete, tributos, total de impostos ou valor da mercadoria como substituto.
- registrationDollar = somente "Dolar de Registro", "taxa de cambio" ou "taxa de conversao" explicitamente ligada ao registro. Nao use valor total em USD.
- insuranceValue = somente "Seguro"/"Valor do Seguro" explicitamente impresso; nao confunda com frete.
- duimpNumber = numero da DUIMP exatamente como impresso, sem inventar formato.
- registeredAt = "Data de Registro"; customsClearanceAt = "Data de Desembaraco". Datas devem estar em YYYY-MM-DD.
- customsChannel = canal RFB/parametrizacao. Quando o documento usar VERDE, AMARELO, VERMELHO ou CINZA, retorne o nome em portugues com inicial maiuscula.
- processReference = referência comercial do processo do importador (ex.: PK2192607SZ) somente quando explicitamente impressa; não use número DUIMP, código interno Fenicia nem número sequencial como referência do processo.
- Extraia importerCnpj, currency, totalFobValue, totalNetWeight e totalGrossWeight somente quando explicitamente impressos. FOB nunca equivale ao valor aduaneiro; preserve a moeda impressa (USD, BRL etc.).
- items contém cada item identificado, com itemCode textual exato (zeros iniciais e prefixos preservados), quantity e ncmCode. Não confunda número sequencial da adição ou código do catálogo de produtos do Portal Único com SKU comercial. O campo "Código do produto" da DUIMP pode ser código do catálogo (ex.: 2373) e não prova SKU; só preencha itemCode quando a referência comercial estiver explicitamente identificada. Sem SKU impresso, itemCode deve ser null.
- unitType = unidade comercial explicitamente impressa para a quantidade daquele item (UN, PCS, PAR, SET, KG, DZ). Não use unidade estatística como comercial, não infira UN quando ausente; retorne null. quantity e unitType devem referir-se ao mesmo campo comercial.
- Numeros usam ponto ou virgula conforme o documento; devolva number JSON sem simbolo monetario.

Responda SOMENTE com JSON estrito neste formato:
{
  "processReference": { "value": string|null, "confidence": number },
  "importerCnpj": { "value": string|null, "confidence": number },
  "currency": { "value": string|null, "confidence": number },
  "totalFobValue": { "value": number|null, "confidence": number },
  "totalNetWeight": { "value": number|null, "confidence": number },
  "totalGrossWeight": { "value": number|null, "confidence": number },
  "items": [{ "itemCode": { "value": string|null, "confidence": number }, "quantity": { "value": number|null, "confidence": number }, "unitType": { "value": string|null, "confidence": number }, "ncmCode": { "value": string|null, "confidence": number } }],
  "customsValue": { "value": number|null, "confidence": number },
  "registrationDollar": { "value": number|null, "confidence": number },
  "insuranceValue": { "value": number|null, "confidence": number },
  "duimpNumber": { "value": string|null, "confidence": number },
  "registeredAt": { "value": "YYYY-MM-DD"|null, "confidence": number },
  "customsClearanceAt": { "value": "YYYY-MM-DD"|null, "confidence": number },
  "customsChannel": { "value": string|null, "confidence": number }
}`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte ${label}:\n\n${text}`,
    },
  ];
}

export type { DuimpDocumentType };
