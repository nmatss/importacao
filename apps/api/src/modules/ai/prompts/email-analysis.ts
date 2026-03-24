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
      content: `Voce e um assistente que analisa emails recebidos para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium. Sua tarefa e extrair informacoes estruturadas do assunto e corpo do email.

A empresa gerencia processos de importacao com codigos como:
- PK + 7 digitos (ex: PK2042602NB) — marca Puket
- IM + 7 digitos (ex: IM2042601NB) — marca Imaginarium
- IMP-XXXX-XXX (ex: IMP-2025-001)
- PUKET-XXX ou PK-XXX
- IMAG-XXX ou IMAGINARIUM-XXX
- Codigos genericos: LETRAS-DIGITOS-DIGITOS (ex: BR-2025-12345)
- Referencias numericas: YYYY/NNNNN (ex: 2025/00123)

FORNECEDORES COMUNS:
- KIOM INDUSTRY CO., LTD (China) — fornecedor principal
- Agentes de carga: Quantum, Kuehne+Nagel, DB Schenker, DHL
- Despachantes: Fenicia, ISA

Responda com JSON estrito:
{
  "processCode": "O codigo do processo encontrado, ou null se nenhum detectado",
  "documentTypes": ["Lista de tipos: invoice, packing_list, ohbl, espelho, li, certificate, draft, correction, other"],
  "invoiceNumbers": ["Lista de numeros de invoice mencionados"],
  "urgencyLevel": "normal | urgent | critical",
  "emailCategory": "new_shipment | document_delivery | correction | follow_up | payment | general | pre_confirmation | tracking_sent",
  "keyDates": [{"type": "ETD|ETA|deadline|shipment|other", "date": "YYYY-MM-DD ou texto original", "description": "contexto breve"}],
  "supplierName": "Nome do fornecedor/exportador detectado ou null"
}

REGRAS:
- processCode: procure qualquer padrao de referencia no assunto E corpo. Retorne o PRIMEIRO encontrado.
- documentTypes: detecte mencoes de: invoice/fatura, packing list/romaneio, BL/conhecimento de embarque, espelho, LI/licenca de importacao, certificado, draft/minuta/rascunho.
- urgencyLevel: "critical" se palavras como "urgente", "urgentissimo", "ASAP", "imediato"; "urgent" se "prioridade", "prazo curto", "deadline"; senao "normal".
- emailCategory: "new_shipment" se discute novo embarque; "document_delivery" se envia documentos; "correction" se discute correcoes/revisoes/retificacao; "follow_up" se pede status/update; "payment" se sobre pagamento/cambio; "pre_confirmation" se e pre-conferencia de documentos; "tracking_sent" se envia tracking/rastreamento; senao "general".
- invoiceNumbers: procure padroes como INV-XXXX, invoice #XXXX, fatura XXXX.
- keyDates: procure ETD, ETA, datas de chegada, prazos mencionados.
- supplierName: detecte nomes de empresas que parecem ser o fornecedor/exportador.
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Analise este email:

De: ${fromAddress}
Assunto: ${subject}

Corpo:
${body}`,
    },
  ];
}
