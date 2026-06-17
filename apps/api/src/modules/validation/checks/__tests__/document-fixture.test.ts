import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allChecks, type CheckInput } from '../index.js';

const ODOO_ENV_KEYS = ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_PASSWORD'] as const;

const originalOdooEnv = new Map<string, string | undefined>(
  ODOO_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const coherentDocumentSet: CheckInput = {
  invoiceData: {
    exporterName: 'NINGBO TEXTILE EXPORT CO LTD',
    exporterAddress: '88 Harbor Road, Ningbo, China',
    supplierAddress: '88 Harbor Road, Ningbo, China',
    importerName: 'IMPORTACAO DEMO LTDA',
    invoiceNumber: 'PO-2026-7752',
    referenceNumber: 'PO-2026-7752',
    incoterm: 'FOB - Ningbo, China',
    currency: 'US$',
    invoiceDate: '2026-06-01',
    shipmentDate: '2026-06-08',
    portOfLoading: 'Ningbo, China',
    portOfDischarge: 'Itapoa, Brazil',
    totalFobValue: 1160,
    totalNetWeight: 100,
    totalGrossWeight: 115,
    totalBoxes: 12,
    totalCbm: 2.4,
    manufacturerName: 'NINGBO TEXTILE EXPORT CO LTD',
    manufacturerAddress: '88 Harbor Road, Ningbo, China',
    paymentTerms: {
      depositPercent: 30,
      balancePercent: 70,
      paymentDays: 30,
    },
    items: [
      {
        itemCode: 'PI 7752Y',
        description: 'Kids socks dino',
        quantity: 100,
        unitPrice: 10,
        totalPrice: 1000,
        unitType: 'PAR',
        netWeight: 80,
        grossWeight: 92,
        ncm: '61159500',
        manufacturer: 'NINGBO TEXTILE EXPORT CO LTD',
      },
      {
        itemCode: 'PI 7753Y',
        description: 'Kids socks stripe',
        quantity: 20,
        unitPrice: 8,
        totalPrice: 160,
        unitType: 'PAR',
        netWeight: 20,
        grossWeight: 23,
        ncm: '61159500',
        manufacturer: 'NINGBO TEXTILE EXPORT CO LTD',
      },
    ],
  },
  packingListData: {
    exporterName: 'NINGBO TEXTILE EXPORT CO., LTD.',
    exporterAddress: '88 Harbor Road, Ningbo, China',
    importerName: 'IMPORTACAO DEMO LTDA',
    packingListNumber: 'PO-2026-7752',
    referenceNumber: 'PO-2026-7752',
    shipmentDate: '08/06/2026',
    portOfLoading: 'Ningbo',
    portOfDischarge: 'Itapoa',
    totalNetWeight: 100.1,
    totalGrossWeight: 115.2,
    totalBoxes: 12,
    totalCbm: 2.45,
    items: [
      {
        itemCode: 'PI-7752Y',
        description: 'Kids socks dino',
        quantity: 100,
        unitType: 'PAR',
        netWeight: 80.1,
        grossWeight: 92.1,
      },
      {
        itemCode: 'PI.7753Y',
        description: 'Kids socks stripe',
        quantity: 20,
        unitType: 'PAR',
        netWeight: 20,
        grossWeight: 23.1,
      },
    ],
  },
  blData: {
    shipper: 'NINGBO TEXTILE EXPORT CO., LTD.',
    consignee: 'IMPORTACAO DEMO LTDA',
    customerReference: 'PO-2026-7752',
    blNumber: 'SHYY26021495A',
    shippedOnBoardDate: '2026-06-09',
    shipmentDate: '2026-06-09',
    portOfLoading: 'Ningbo, China',
    portOfDischarge: 'Itapoa, Brazil',
    cargoDescription: '6115 kids socks textile goods',
    totalGrossWeight: 115.1,
    totalBoxes: 12,
    totalCbm: 2.44,
    totalVolume: 2.44,
    freightValue: 250,
    containerType: '40HC',
  },
  processData: {
    totalFobValue: 1160,
    freightValue: 250,
    totalCbm: 2.44,
    containerType: '40 HC',
    exporterName: 'NINGBO TEXTILE EXPORT CO LTD',
    shipmentDate: '2026-06-09',
    paymentTerms: {
      depositPercent: 30,
      balancePercent: 70,
      paymentDays: 30,
    },
    hasCertification: false,
  },
  followUpData: {
    freightValue: 250,
  },
};

describe('validation document fixture', () => {
  beforeEach(() => {
    for (const key of ODOO_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ODOO_ENV_KEYS) {
      const original = originalOdooEnv.get(key);
      if (original == null) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it('runs a coherent INV/PL/OHBL/FUP set through real checks without hard failures', async () => {
    const results = await Promise.all(allChecks.map((check) => check(coherentDocumentSet)));
    const failed = results.filter((result) => result.status === 'failed');

    expect(failed).toEqual([]);
    expect(results.find((result) => result.checkName === 'incoterm-check')?.status).toBe('passed');
    expect(results.find((result) => result.checkName === 'currency-check')?.status).toBe('passed');
    expect(results.find((result) => result.checkName === 'dates-match')?.status).toBe('passed');
    expect(results.find((result) => result.checkName === 'item-level-match')?.status).toBe(
      'passed',
    );
  });
});
