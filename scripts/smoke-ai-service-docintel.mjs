#!/usr/bin/env node

if ((process.env.AI_PROVIDER || 'ialocal') !== 'ialocal') {
  console.error(JSON.stringify({ ok: false, error: 'AI_PROVIDER deve ser ialocal' }));
  process.exit(1);
}
if ((process.env.AI_ALLOW_EXTERNAL || 'false') !== 'false') {
  console.error(JSON.stringify({ ok: false, error: 'AI_ALLOW_EXTERNAL deve ser false' }));
  process.exit(1);
}
if ((process.env.IA_LOCAL_MODEL || 'unico-docintel') !== 'unico-docintel') {
  console.error(JSON.stringify({ ok: false, error: 'IA_LOCAL_MODEL deve ser unico-docintel' }));
  process.exit(1);
}

process.env.AI_MONTHLY_BUDGET_USD ||= '0';
process.env.LOG_LEVEL ||= 'fatal';

const { aiService } = await import('../apps/api/src/modules/ai/service.ts');

const invoiceText = `COMMERCIAL INVOICE
Invoice No: INV-SAN-001        Date: 2026-05-12
Exporter: SANITIZED EXPORTER LTD - NINGBO, CHINA
Importer: EMPRESA TESTE S/A - SAO PAULO, BRASIL  CNPJ: 11.222.333/0001-81
Incoterm: FOB        Currency: USD
Port of Loading: NINGBO        Port of Discharge: ITAPOA, BRAZIL
Item   Code      Description          Qty     Unit Price   Amount     NCM        EAN
1      TEST001   PRODUTO SANITIZADO    120     8.50         1020.00    6115.95.00 7909692093303
TOTAL FOB: USD 1020.00`;

const liText = `LICENCA DE IMPORTACAO
LI: 26/1234567-0
Data Registro: 2026-05-20
Importador: EMPRESA TESTE S/A CNPJ 11.222.333/0001-81
Exportador: SANITIZED EXPORTER LTD
NCM: 6115.95.00
Descricao: PRODUTO SANITIZADO PARA TESTE
Quantidade: 120 UN
Valor FOB: USD 1020.00
Processo: TESTE-SANITIZADO`;

const packingListText = `PACKING LIST
Packing List No: PL-SAN-001      Date: 2026-05-12
Invoice No: INV-SAN-001
Exporter: SANITIZED EXPORTER LTD - NINGBO, CHINA
Importer: EMPRESA TESTE S/A CNPJ 11.222.333/0001-81
Port of Loading: NINGBO        Port of Discharge: ITAPOA, BRAZIL
Item Code Description Qty Cartons Net Weight Gross Weight EAN
1 TEST001 PRODUTO SANITIZADO 120 12 60.5 66.7 7909692093303
Total Cartons: 12
Total Net Weight: 60.5
Total Gross Weight: 66.7
Total CBM: 1.23`;

const invoiceData = {
  invoiceNumber: 'INV-SAN-001',
  currency: 'USD',
  totalFobValue: 1020,
  items: [{ itemCode: 'TEST001', quantity: 120, unitPrice: 8.5, totalPrice: 1020, ncmCode: '6115.95.00' }],
};
const packingListData = {
  totalBoxes: 12,
  items: [{ itemCode: 'TEST001', quantity: 120, boxQuantity: 12, netWeight: 60, grossWeight: 66 }],
};
const blData = { blNumber: 'BL-SAN-001', containers: ['CSQU3054383'], portOfDischarge: 'ITAPOA' };

let failed = false;

async function timed(name, fn) {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    const data = result?.data || result;
    const keys = data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [];
    const trust = result?._trust?.trust || result?.trust || null;
    const findings = result?._trust?.findings?.length ?? result?.findings?.length ?? null;
    console.log(JSON.stringify({ check: name, ok: true, ms, keys, trust, findings }));
  } catch (error) {
    const ms = Math.round(performance.now() - start);
    failed = true;
    console.log(JSON.stringify({ check: name, ok: false, ms, error: error?.message || String(error) }));
  }
}

await timed('aiService.detectAnomalies', () =>
  aiService.detectAnomalies(invoiceData, packingListData, blData),
);
await timed('aiService.extractLIData', () => aiService.extractLIData(liText));
await timed('aiService.extractInvoiceData.sanitized', () => aiService.extractInvoiceData(invoiceText));
await timed('aiService.extractPackingListData.sanitized', () =>
  aiService.extractPackingListData(packingListText),
);

if (failed) process.exit(1);
