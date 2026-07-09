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
- Numeros usam ponto ou virgula conforme o documento; devolva number JSON sem simbolo monetario.

Responda SOMENTE com JSON estrito neste formato:
{
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
