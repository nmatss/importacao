interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildAnomalyPrompt(
  invoiceData: Record<string, any>,
  packingListData: Record<string, any>,
  blData: Record<string, any>,
): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `You are a specialized anomaly detection AI for international trade documents. Your task is to cross-reference data across a commercial invoice, packing list, and Bill of Lading to identify discrepancies and potential issues.

Perform the following checks:

1. **Name consistency**: Compare exporter/shipper names across documents. Flag minor formatting differences (e.g., "Co., Ltd." vs "Co. Ltd", extra spaces, different abbreviations) as low severity, and completely different names as high severity.

2. **Numerical consistency**: Compare totals across documents:
   - Total boxes/cartons should match across all three documents.
   - Total gross weight should match between packing list and B/L.
   - Total CBM should match between packing list and B/L.
   - Item quantities in invoice should match packing list.

3. **Port consistency**: Port of loading and port of discharge should match between invoice and B/L.

4. **Missing data**: Flag any critical fields that are missing from any document (e.g., missing invoice number, missing B/L number, missing container number).

5. **Date consistency**: Check that shipment/B/L dates are not before invoice dates.

6. **Importer/Consignee consistency**: The importer on the invoice should match the consignee on the B/L.

Respond with strict JSON in this format:
{
  "anomalies": [
    {
      "field": "fieldName",
      "description": "Description of the discrepancy found",
      "severity": "low|medium|high"
    }
  ]
}

Severity guidelines:
- **low**: Minor formatting differences, non-critical missing data, small rounding differences in weights/volumes.
- **medium**: Moderate discrepancies that need review, such as slight quantity mismatches, date inconsistencies, or partial data mismatches.
- **high**: Critical issues like completely different names, large numerical discrepancies, missing essential documents data, or values that suggest incorrect document matching.

If no anomalies are found, return: { "anomalies": [] }

Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Cross-reference the following three documents and identify any anomalies:

=== COMMERCIAL INVOICE DATA ===
${JSON.stringify(invoiceData, null, 2)}

=== PACKING LIST DATA ===
${JSON.stringify(packingListData, null, 2)}

=== BILL OF LADING DATA ===
${JSON.stringify(blData, null, 2)}`,
    },
  ];
}
