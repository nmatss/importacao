interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildPackingListPrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `You are a specialized data extraction AI for international trade documents. Your task is to extract structured data from packing lists.

Extract the following fields from the packing list text provided. For each field, include a confidence score between 0.0 and 1.0 indicating how confident you are in the extracted value.

Respond with strict JSON in this exact format:
{
  "packingListNumber": { "value": "", "confidence": 0.0 },
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

Rules:
- If a field is not found in the document, set its value to null and confidence to 0.0.
- Dates should be in ISO 8601 format (YYYY-MM-DD).
- Numeric values should be numbers, not strings.
- Weight values should be in kilograms (kg).
- CBM values should be in cubic meters.
- Extract ALL line items from the packing list.
- Do not invent or assume data that is not present in the document.
- Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Extract data from the following packing list:\n\n${text}`,
    },
  ];
}
