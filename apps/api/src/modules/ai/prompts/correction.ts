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

  const divergenceSummary = Object.entries(divergencesByCategory).map(([cat, items]) => {
    const itemsText = items.map(d =>
      `  - ${d.checkName}: Esperado "${d.expectedValue || 'N/A'}" / Encontrado "${d.actualValue || 'N/A'}" — ${d.message}`
    ).join('\n');
    return `[${cat}]\n${itemsText}`;
  }).join('\n\n');

  return [
    {
      role: 'system',
      content: `Voce e um assistente profissional de uma empresa de importacao brasileira. Sua tarefa e redigir um e-mail formal de solicitacao de correcao de documentos em portugues brasileiro.

O e-mail deve:
- Ser enderecado ao fornecedor/KIOM
- Referenciar o codigo do processo e numero da fatura
- Listar cada divergencia encontrada com valores esperados vs encontrados
- Solicitar as correcoes especificas necessarias
- Ser profissional, conciso e objetivo
- Usar tom formal mas cordial
- Terminar com "Atenciosamente," seguido de "[ASSINATURA]"

Responda com JSON estrito neste formato:
{
  "subject": "Assunto do e-mail em portugues",
  "body": "Corpo completo do e-mail em HTML com formatacao profissional usando tags <p>, <ul>, <li>, <strong>, <table>, etc."
}

O corpo em HTML deve:
- Usar uma tabela para listar as divergencias (com colunas: Verificacao, Esperado, Encontrado, Detalhes)
- Ter estilos inline para boa apresentacao (font-family Arial, cores profissionais)
- Incluir cabecalho com titulo "Correcao de Documentos Necessaria"
- Agrupar divergencias por categoria quando houver mais de uma categoria

Responda SOMENTE com o objeto JSON, sem texto adicional.`,
    },
    {
      role: 'user',
      content: `Gere um e-mail profissional de solicitacao de correcao baseado nos seguintes dados:

Processo: ${context.processCode}
Marca: ${context.brand}
${context.invoiceNumber ? `Fatura: ${context.invoiceNumber}` : ''}
${context.exporterName ? `Exportador: ${context.exporterName}` : ''}

Divergencias encontradas:
${divergenceSummary}`,
    },
  ];
}
