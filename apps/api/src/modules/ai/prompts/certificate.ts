interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildCertificatePrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `You are a specialized data extraction AI for international trade documents. Your task is to extract structured data from certificates (Certificate of Origin, INMETRO, quality certificates, phytosanitary certificates, etc.).

Extract the following fields from the certificate text provided. For each field, include a confidence score between 0.0 and 1.0 indicating how confident you are in the extracted value.

Respond with strict JSON in this exact format:
{
  "certificateType": { "value": "", "confidence": 0.0 },
  "certificateNumber": { "value": "", "confidence": 0.0 },
  "issuingAuthority": { "value": "", "confidence": 0.0 },
  "issueDate": { "value": "", "confidence": 0.0 },
  "expirationDate": { "value": "", "confidence": 0.0 },
  "exporterName": { "value": "", "confidence": 0.0 },
  "importerName": { "value": "", "confidence": 0.0 },
  "countryOfOrigin": { "value": "", "confidence": 0.0 },
  "invoiceReference": { "value": "", "confidence": 0.0 },
  "items": [
    {
      "description": { "value": "", "confidence": 0.0 },
      "itemCode": { "value": "", "confidence": 0.0 },
      "ncmCode": { "value": "", "confidence": 0.0 },
      "quantity": { "value": 0, "confidence": 0.0 }
    }
  ],
  "observations": { "value": "", "confidence": 0.0 }
}

Rules:
- certificateType should be one of: "origin", "inmetro", "quality", "phytosanitary", "fumigation", "radiation", "other"
- If a field is not found in the document, set its value to null and confidence to 0.0.
- Dates should be in ISO 8601 format (YYYY-MM-DD).
- Numeric values should be numbers, not strings.
- Extract ALL items listed in the certificate.
- Do not invent or assume data that is not present in the document.
- Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Extract data from the following certificate document:\n\n${text}`,
    },
  ];
}
