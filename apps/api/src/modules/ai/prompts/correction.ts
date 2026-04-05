interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CorrectionDivergence {
  checkName: string;
  category: string;
  expectedValue?: string;
  actualValue?: string;
  message: string;
}

interface CorrectionContext {
  processCode: string;
  brand: string;
  invoiceNumber?: string;
  exporterName?: string;
  divergences: CorrectionDivergence[];
}

export function buildCorrectionPrompt(context: CorrectionContext): OpenRouterMessage[] {
  const divergencesByCategory: Record<string, CorrectionDivergence[]> = {};
  for (const d of context.divergences) {
    if (!divergencesByCategory[d.category]) {
      divergencesByCategory[d.category] = [];
    }
    divergencesByCategory[d.category].push(d);
  }

  const divergenceSummary = Object.entries(divergencesByCategory)
    .map(([cat, items]) => {
      const itemsText = items
        .map(
          (d) =>
            `  - ${d.checkName}: Expected "${d.expectedValue || 'N/A'}" / Found "${d.actualValue || 'N/A'}" — ${d.message}`,
        )
        .join('\n');
      return `[${cat}]\n${itemsText}`;
    })
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `You are a professional assistant for a Brazilian import company. Your task is to draft a formal document-correction request email in English.

The email must:
- Be addressed to the supplier/KIOM
- Reference the process code and invoice number
- List each divergence found with expected vs. found values
- Request the specific corrections needed
- Be professional, concise and objective
- Use a formal yet cordial tone
- End with "Best regards," followed by "[SIGNATURE]"

Respond with strict JSON in this format:
{
  "subject": "Email subject in English",
  "body": "Full email body as HTML with professional formatting using <p>, <ul>, <li>, <strong>, <table>, etc."
}

The HTML body must:
- Use a table to list the divergences (columns: Check, Expected, Found, Details)
- Include inline styles for good presentation (Arial font-family, professional colors)
- Include a header with the title "Document Correction Required"
- Group divergences by category when more than one category is present

Respond ONLY with the JSON object, no additional text.`,
    },
    {
      role: 'user',
      content: `Generate a professional correction-request email based on the following data:

Process: ${context.processCode}
Brand: ${context.brand}
${context.invoiceNumber ? `Invoice: ${context.invoiceNumber}` : ''}
${context.exporterName ? `Exporter: ${context.exporterName}` : ''}

Divergences found:
${divergenceSummary}`,
    },
  ];
}
