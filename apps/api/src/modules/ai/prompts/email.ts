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
      ? `You are drafting an email to the customs broker "Fenicia Despachos Aduaneiros". The email must:
- Be professional and formal in English.
- Reference the import process details (invoice number, exporter, vessel, container).
- Mention that relevant documents are attached (invoice, packing list, BL, and certificates if applicable).
- Request that they proceed with customs clearance.
- Include relevant deadlines (ETA, vessel arrival).
- Ask for confirmation of receipt and expected clearance timeline.`
      : `You are drafting an email to "Isa" about certification requirements for the import process. The email must:
- Be professional and formal in English.
- Reference the process details (invoice number, exporter, products).
- Inquire about or provide information on required certifications (INMETRO, ANVISA, or product-specific certifications).
- Mention product descriptions and NCM codes as reference.
- Request confirmation of certification status or pending items.`;

  return [
    {
      role: 'system',
      content: `You are a professional email-writing assistant for Grupo Uni.co, a Brazilian importer of the Puket and Imaginarium brands. ${recipientInstructions}

Respond with strict JSON:
{
  "subject": "Email subject in English",
  "body": "Full email body in English with greeting and signature"
}

The email body must:
- Begin with an appropriate greeting (e.g., "Dear team," or "Dear Isa,")
- Be well structured with clear paragraphs
- End with "Best regards," followed by "[SIGNATURE]"
- Use formal English

Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Generate a professional email based on the following process data:\n\n${JSON.stringify(processData, null, 2)}`,
    },
  ];
}
