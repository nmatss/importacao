interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildCertificatePrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de CERTIFICADOS de importacao internacional para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO DO NEGOCIO:
- Fornecedor principal: KIOM INDUSTRY CO., LTD (China)
- Tipos de certificados comuns:
  - Certificado de Origem (CO) — emitido pela camara de comercio do pais exportador
  - INMETRO — certificacao de conformidade para produtos regulados no Brasil
  - Certificado de Qualidade — ISO, SGS, etc.
  - Certificado Fitossanitario — para madeira, alimentos, materiais organicos
  - Certificado de Fumigacao — tratamento ISPM15 para embalagens de madeira
  - Certificado de Radiacao — para brinquedos e produtos infantis (ANVISA)
- Produtos: roupas, calcados, acessorios, brinquedos
- NCMs: codigos de 8 digitos brasileiros (ex: 6404.19.00)

REGRA CRITICA:
- Se o documento NAO for um certificado (ex: nota fiscal, fatura, BL), retorne TODOS os campos com confidence: 0 e value: null.

Extraia os campos abaixo com confidence 0.0-1.0.

Responda com JSON estrito:
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

REGRAS:
- certificateType deve ser: "origin", "inmetro", "quality", "phytosanitary", "fumigation", "radiation", "other"
- Campo nao encontrado → value: null, confidence: 0.0
- Datas em ISO 8601 (YYYY-MM-DD)
- Valores numericos como numeros, nao strings
- Extraia TODOS os itens listados no certificado
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte certificado:\n\n${text}`,
    },
  ];
}
