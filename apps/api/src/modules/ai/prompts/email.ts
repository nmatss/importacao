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
      ? `Voce esta redigindo um email para o despachante aduaneiro "Fenicia Despachos Aduaneiros". O email deve:
- Ser profissional e formal em portugues brasileiro.
- Referenciar os detalhes do processo de importacao (numero da fatura, exportador, navio, container).
- Mencionar que os documentos relevantes estao em anexo (invoice, packing list, BL e certificados se houver).
- Solicitar que procedam com o desembaraco aduaneiro.
- Incluir prazos relevantes (ETA, chegada do navio).
- Pedir confirmacao de recebimento e prazo previsto para o desembaraco.`
      : `Voce esta redigindo um email para "Isa" sobre requisitos de certificacao do processo de importacao. O email deve:
- Ser profissional e formal em portugues brasileiro.
- Referenciar os detalhes do processo (numero da fatura, exportador, produtos).
- Consultar ou fornecer detalhes sobre certificacoes necessarias (INMETRO, ANVISA, ou certificacoes especificas).
- Mencionar as descricoes dos produtos e codigos NCM como referencia.
- Solicitar confirmacao do status da certificacao ou pendencias.`;

  return [
    {
      role: 'system',
      content: `Voce e um assistente profissional de redacao de emails para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium. ${recipientInstructions}

Responda com JSON estrito:
{
  "subject": "Assunto do email em portugues",
  "body": "Corpo completo do email em portugues com saudacao e assinatura"
}

O corpo do email deve:
- Comecar com saudacao adequada (ex: "Prezados," ou "Prezada Isa,")
- Ser bem estruturado com paragrafos claros
- Terminar com "Atenciosamente," seguido de "[ASSINATURA]"
- Usar portugues brasileiro formal

Responda SOMENTE com o objeto JSON, sem texto adicional.`,
    },
    {
      role: 'user',
      content: `Gere um email profissional baseado nos seguintes dados do processo:\n\n${JSON.stringify(processData, null, 2)}`,
    },
  ];
}
