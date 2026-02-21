interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildEmailPrompt(
  processData: Record<string, any>,
  recipientType: 'fenicia' | 'isa',
): OpenRouterMessage[] {
  const recipientInstructions =
    recipientType === 'fenicia'
      ? `You are drafting an email to the customs broker "Fenícia Despachos Aduaneiros". The email should:
- Be professional and formal in Brazilian Portuguese.
- Reference the import process details (invoice number, exporter, vessel, container).
- Mention that the relevant documents are attached (invoice, packing list, B/L, and any certificates).
- Request that they proceed with the customs clearance process (desembaraço aduaneiro).
- Include any relevant deadlines (ETA, vessel arrival).
- Ask them to confirm receipt and provide a timeline for the clearance.`
      : `You are drafting an email to "Isa" regarding certification requirements for the import process. The email should:
- Be professional and formal in Brazilian Portuguese.
- Reference the import process details (invoice number, exporter, products).
- Inquire about or provide details on required certifications (e.g., INMETRO, ANVISA, or product-specific certifications).
- Mention the product descriptions and NCM codes for reference.
- Request confirmation of certification status or any pending requirements.`;

  return [
    {
      role: 'system',
      content: `You are a professional email drafting assistant for a Brazilian import company. ${recipientInstructions}

Respond with strict JSON in this format:
{
  "subject": "Email subject line in Portuguese",
  "body": "Full email body in Portuguese with proper greeting and signature placeholder"
}

The email body should:
- Start with a proper greeting (e.g., "Prezados," or "Prezada Isa,")
- Be well-structured with clear paragraphs
- End with "Atenciosamente," followed by a signature placeholder "[ASSINATURA]"
- Use formal Brazilian Portuguese

Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Generate a professional email based on the following process data:\n\n${JSON.stringify(processData, null, 2)}`,
    },
  ];
}
