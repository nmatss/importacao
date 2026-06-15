export function buildLIPrompt(text: string) {
  return [
    {
      role: 'system',
      content: `You are a Brazilian import compliance specialist. Extract data from a Licenca de Importacao (LI / Siscomex) document.

Return strict JSON only. If the document is not an LI, return all scalar fields as { "value": null, "confidence": 0 } and items as an empty array.

Expected JSON shape:
{
  "liNumber": { "value": string|null, "confidence": number },
  "registrationDate": { "value": "YYYY-MM-DD"|null, "confidence": number },
  "deferralDate": { "value": "YYYY-MM-DD"|null, "confidence": number },
  "status": { "value": "pending|requested|submitted|deferred|expired|cancelled"|null, "confidence": number },
  "importerName": { "value": string|null, "confidence": number },
  "importerCnpj": { "value": string|null, "confidence": number },
  "exporterName": { "value": string|null, "confidence": number },
  "items": [
    {
      "ncmCode": { "value": string|null, "confidence": number },
      "description": { "value": string|null, "confidence": number },
      "quantity": { "value": number|null, "confidence": number },
      "unitPrice": { "value": number|null, "confidence": number }
    }
  ],
  "totalValue": { "value": number|null, "confidence": number },
  "currency": { "value": string|null, "confidence": number },
  "incoterm": { "value": string|null, "confidence": number },
  "anuentes": { "value": string[]|null, "confidence": number }
}`,
    },
    {
      role: 'user',
      content: `Extract LI data from this document:\n\n${text}`,
    },
  ];
}
