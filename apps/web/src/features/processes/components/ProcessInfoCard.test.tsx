import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ImportProcess } from '@/shared/types';
import { ProcessInfoCard } from './ProcessInfoCard';

function makeProcess(overrides: Partial<ImportProcess> = {}): ImportProcess {
  return {
    id: 1,
    processCode: 'IMP-001',
    brand: 'puket',
    status: 'draft',
    logisticStatus: 'consolidation',
    incoterm: null,
    portOfLoading: null,
    portOfDischarge: null,
    etd: null,
    eta: null,
    shipmentDate: null,
    etaActual: null,
    customsClearanceAt: null,
    cdArrivalAt: null,
    exporterName: null,
    exporterAddress: null,
    importerName: null,
    importerAddress: null,
    totalFobValue: null,
    freightValue: null,
    totalBoxes: null,
    totalNetWeight: null,
    totalGrossWeight: null,
    totalCbm: null,
    containerType: null,
    vesselName: null,
    blNumber: null,
    shippingLine: null,
    diNumber: null,
    customsChannel: null,
    freightAgent: null,
    inspectionType: null,
    hasLiItems: false,
    hasCertification: false,
    hasFreeOfCharge: false,
    correctionStatus: null,
    paymentTerms: null,
    aiExtractedData: null,
    notes: null,
    driveFolderId: null,
    sistemaDriveFolderId: null,
    createdAt: '2026-04-11T00:00:00.000Z',
    updatedAt: '2026-04-11T00:00:00.000Z',
    documents: [],
    followUp: null,
    ...overrides,
  };
}

describe('ProcessInfoCard', () => {
  it('fills process information from espelho when invoice is not available', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            espelho: {
              summary: {
                importerName: 'IMPORTADOR ESPELHO',
                totalAmountUsd: 1234.56,
                totalBoxes: 42,
                totalNetWeight: 100.5,
                totalGrossWeight: 112.75,
                totalCbm: 8.25,
                shippingLine: 'MSC',
              },
              items: [{ fornecedor: 'FORNECEDOR ESPELHO' }],
            },
          },
        })}
      />,
    );

    expect(screen.getByText('FORNECEDOR ESPELHO')).toBeInTheDocument();
    expect(screen.getByText('IMPORTADOR ESPELHO')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('MSC')).toBeInTheDocument();
    expect(screen.getAllByTitle('Fonte: Espelho').length).toBeGreaterThanOrEqual(5);
  });

  it('prioritizes invoice values over espelho values when both are available', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          exporterName: 'FORNECEDOR MANUAL',
          aiExtractedData: {
            invoice: {
              exporterName: 'FORNECEDOR INVOICE',
              importerName: 'IMPORTADOR INVOICE',
              incoterm: 'FOB',
              totalFobValue: 2000,
              totalBoxes: 12,
            },
            espelho: {
              summary: {
                importerName: 'IMPORTADOR ESPELHO',
                totalAmountUsd: 1234.56,
                totalBoxes: 42,
              },
              items: [{ fornecedor: 'FORNECEDOR ESPELHO' }],
            },
          },
        })}
      />,
    );

    expect(screen.getByText('FORNECEDOR INVOICE')).toBeInTheDocument();
    expect(screen.getByText('IMPORTADOR INVOICE')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('FORNECEDOR ESPELHO')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Fonte: Invoice').length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to BL espelho summary for Data Embarque, Frete and Container', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            espelho: {
              summary: {
                shipmentDate: '2026-02-10T00:00:00.000Z',
                etd: '2026-02-08T00:00:00.000Z',
                freightValue: 3200,
                freightCurrency: 'USD',
                containerNumber: 'MSKU1234567',
              },
              items: [],
            },
          },
        })}
      />,
    );

    // Data Embarque from espelho.summary.shipmentDate (timezone-tolerant)
    expect(screen.getByText(/0[19]\/02\/2026|10\/02\/2026/)).toBeInTheDocument();
    // Frete formatted with the espelho currency
    expect(screen.getByText(/3\.200,00/)).toBeInTheDocument();
    // Container number (ISO 6346) distinct from containerType
    expect(screen.getByText('MSKU1234567')).toBeInTheDocument();
    expect(screen.getByText('Numero Container')).toBeInTheDocument();
    // Labelled as sourced from Espelho
    expect(screen.getAllByTitle('Fonte: Espelho').length).toBeGreaterThanOrEqual(3);
  });

  it('pairs Frete currency with the source that won the value, not a foreign source', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            // Invoice wins only because the espelho has no freight value; the
            // espelho currency (EUR) must NOT leak onto the invoice value.
            invoice: { freightValue: 1500 },
            espelho: {
              summary: { freightCurrency: 'EUR' },
              items: [],
            },
          },
        })}
      />,
    );

    // Defaults to USD (no invoice currency) — not EUR from the espelho summary.
    expect(screen.getByText(/US\$\s?1\.500,00/)).toBeInTheDocument();
    expect(screen.queryByText(/€\s?1\.500,00/)).not.toBeInTheDocument();
  });

  it('reads Data Embarque, Frete and Container straight from the BL doc before the espelho is built', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            // No espelho summary yet — only the extracted BL (ohbl). The card
            // must still surface shipping/freight/container from the BL.
            ohbl: {
              shipmentDate: '2026-02-10T00:00:00.000Z',
              freightValue: 3200,
              freightCurrency: 'USD',
              containerNumber: 'MSKU1234567',
              containerType: '40HQ',
            },
          },
        })}
      />,
    );

    expect(screen.getByText(/0[19]\/02\/2026|10\/02\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/3\.200,00/)).toBeInTheDocument();
    expect(screen.getByText('MSKU1234567')).toBeInTheDocument();
    // Labelled as sourced from the BL
    expect(screen.getAllByTitle('Fonte: BL').length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to espelho.summary.etd for Data Embarque when shipmentDate is absent', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            espelho: {
              summary: { etd: '2026-02-08T00:00:00.000Z' },
              items: [],
            },
          },
        })}
      />,
    );

    expect(screen.getByText(/0[78]\/02\/2026/)).toBeInTheDocument();
  });
});
