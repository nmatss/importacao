interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildBLPrompt(text: string): OpenRouterMessage[] {
  return [
    {
      role: 'system',
      content: `Voce e um especialista em extracao de dados de CONHECIMENTOS DE EMBARQUE (Bills of Lading / B/L) para o Grupo Uni.co, importador brasileiro das marcas Puket e Imaginarium.

CONTEXTO DO NEGOCIO:
- Tipos comuns: OHBL (Original House Bill of Lading), MBL (Master Bill of Lading), HBL (House Bill of Lading)
- Shipper: geralmente KIOM INDUSTRY CO., LTD ou agente de carga (Quantum, etc.)
- Consignee: Grupo Uni.co, IMB TEXTIL S.A., UniCo Participacoes Ltda, ou "TO ORDER"
- Containers: 40'HQ (mais comum), 40'NOR, 20'GP, LCL
- Portos de embarque: Shanghai, Ningbo, Xiamen, Shenzhen, Qingdao (China)
- Portos de destino: Navegantes, Itapoa, Itajai (Brasil)
- Transbordos possiveis: Singapura, Colombo, Tanjung Pelepas, Cartagena
- Armadores: EVERGREEN, CMA CGM, MSC, Maersk, Hapag-Lloyd, ONE, Cosco, OOCL

ATENCAO ESPECIAL:
- "Shipped on Board" ou "On Board Date" = data real de embarque (shipmentDate)
- Container number: formato ISO 6346 = 4 letras + 7 numeros (ex: TCLU1234567)
- Se houver mais de 1 container, liste todos separados por virgula
- BL pode ser PDF escaneado (imagem) — extraia todo texto visivel
- cargoDescription = descricao completa das mercadorias como aparece no BL
- Frete pode ser "PREPAID", "COLLECT", ou valor numerico

REGRAS DE EXTRACAO — BL:
- vesselName: NOME do navio. Se aparecer no formato "VESSEL/VOYAGE" ou "NAVIO/VIAGEM" (ex.: "COSCO SHIPPING ARGENTINA/0BDNIW1MA"), separe: vesselName="COSCO SHIPPING ARGENTINA", voyageNumber="0BDNIW1MA".
- portOfLoading: porto de embarque (ex.: "NINGBO, CHINA", "SHANGHAI, CHINA"). Pode estar rotulado "PORT OF LOADING", "PORT OF ORIGIN", "PORTO DE EMBARQUE".
- portOfDischarge: porto de destino (ex.: "ITAPOA, BRAZIL", "ITAJAI, BRAZIL", "NAVEGANTES, BRAZIL"). Rotulos: "PORT OF DISCHARGE", "PORT OF DESTINATION", "PORTO DE DESCARGA".
- customerReference: referencia do CLIENTE/processo no BL — NAO confunda com blNumber. Rotulos: "ORDER NO.", "ORDER NUMBER", "PO CUSTOMER REF", "CUSTOMER REFERENCE", "SHIPPER REF", "BOOKING REF". Exemplo: "ORDER NO.: IM0712602NB" → customerReference="IM0712602NB".
- blNumber: numero do conhecimento de embarque (ex.: "SHYY26021495A"). E diferente de customerReference.

Extraia os campos abaixo com confidence 0.0-1.0.

Responda com JSON estrito:
{
  "blNumber": { "value": "", "confidence": 0.0 },
  "customerReference": { "value": "", "confidence": 0.0 },
  "shipper": { "value": "", "confidence": 0.0 },
  "consignee": { "value": "", "confidence": 0.0 },
  "notifyParty": { "value": "", "confidence": 0.0 },
  "vesselName": { "value": "", "confidence": 0.0 },
  "voyageNumber": { "value": "", "confidence": 0.0 },
  "portOfLoading": { "value": "", "confidence": 0.0 },
  "portOfDischarge": { "value": "", "confidence": 0.0 },
  "etd": { "value": "", "confidence": 0.0 },
  "eta": { "value": "", "confidence": 0.0 },
  "shipmentDate": { "value": "", "confidence": 0.0 },
  "containerNumber": { "value": "", "confidence": 0.0 },
  "sealNumber": { "value": "", "confidence": 0.0 },
  "totalBoxes": { "value": 0, "confidence": 0.0 },
  "totalGrossWeight": { "value": 0.0, "confidence": 0.0 },
  "totalCbm": { "value": 0.0, "confidence": 0.0 },
  "freightValue": { "value": 0.0, "confidence": 0.0 },
  "freightCurrency": { "value": "", "confidence": 0.0 },
  "containerType": { "value": "", "confidence": 0.0 },
  "cargoDescription": { "value": "", "confidence": 0.0 }
}

REGRAS:
- Campo nao encontrado → value: null, confidence: 0.0
- Datas em ISO 8601 (YYYY-MM-DD)
- ETD = Estimated Time of Departure, ETA = Estimated Time of Arrival
- Pesos em KG, CBM em metros cubicos
- Se frete = "PREPAID" ou "COLLECT", coloque freightValue: null e freightCurrency com o texto
- containerType: tipo do container (ex: "40HQ", "40NOR", "20GP", "LCL") — extrair do campo de container ou descricao
- NAO invente dados. Responda SOMENTE com JSON.`,
    },
    {
      role: 'user',
      content: `Extraia os dados do seguinte Conhecimento de Embarque (Bill of Lading):\n\n${text}`,
    },
  ];
}
