interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildEmailAnalysisPrompt(
  subject: string,
  body: string,
  fromAddress: string,
): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `You are an assistant that analyzes incoming emails for a Brazilian import/export company. Your task is to extract structured information from the email subject and body.

The company manages import processes with codes like:
- IMP-XXXX-XXX (e.g., IMP-2025-001)
- PUKET-XXX or PK-XXX (brand Puket)
- IMAG-XXX or IMAGINARIUM-XXX (brand Imaginarium)
- Generic codes: LETTERS-DIGITS-DIGITS (e.g., BR-2025-12345)
- Numeric references: YYYY/NNNNN (e.g., 2025/00123)

Respond with strict JSON in this format:
{
  "processCode": "The import process code found, or null if none detected",
  "documentTypes": ["List of document types mentioned: invoice, packing_list, ohbl, espelho, li, certificate, draft, correction, other"],
  "invoiceNumbers": ["List of invoice numbers mentioned"],
  "urgencyLevel": "normal | urgent | critical",
  "emailCategory": "new_shipment | document_delivery | correction | follow_up | payment | general",
  "keyDates": [{"type": "ETD|ETA|deadline|shipment|other", "date": "YYYY-MM-DD or raw text", "description": "brief context"}],
  "supplierName": "Detected supplier/exporter name or null"
}

Rules:
- For processCode, look for any reference pattern in both subject and body. Return the FIRST match found.
- For documentTypes, detect mentions of: invoice/fatura, packing list/romaneio, BL/conhecimento de embarque/bill of lading, espelho, LI/licença de importação, certificado/certificate, draft/minuta.
- For urgencyLevel: "critical" if words like "urgente", "urgentíssimo", "ASAP", "imediato" appear; "urgent" if "prioridade", "prazo curto", "deadline"; otherwise "normal".
- For emailCategory: "new_shipment" if it discusses a new shipment/embarque; "document_delivery" if sending documents; "correction" if discussing corrections/revisões/retificação; "follow_up" if asking for status/update/acompanhamento; "payment" if about payment/pagamento/câmbio; otherwise "general".
- For invoiceNumbers, look for patterns like INV-XXXX, invoice #XXXX, fatura XXXX, or similar.
- For keyDates, look for ETD, ETA, arrival dates, deadlines mentioned.
- For supplierName, detect company names that appear to be the supplier/exporter (not the email sender's company).
- Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Analyze this email:

From: ${fromAddress}
Subject: ${subject}

Body:
${body}`,
    },
  ];
}
