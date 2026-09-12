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

  it('unwraps legacy AI { value, confidence } fields instead of rendering object text', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            invoice: {
              exporterName: { value: 'FORNECEDOR WRAPPER', confidence: 0.95 },
              importerName: { value: 'IMPORTADOR WRAPPER', confidence: 0.94 },
              totalBoxes: { value: 12, confidence: 0.9 },
            },
          },
        })}
      />,
    );

    expect(screen.getByText('FORNECEDOR WRAPPER')).toBeInTheDocument();
    expect(screen.getByText('IMPORTADOR WRAPPER')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
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
    // Data de calendario: o dia exibido e o dia do documento, sem tolerancia de
    // fuso (a expectativa antiga aceitava 09 ou 10/02 para um BL de 10/02).
    expect(screen.getByText('10/02/2026')).toBeInTheDocument();
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

  it('renders PREPAID as a freight term instead of passing it as an ISO currency', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            ohbl: {
              freightValue: 3200,
              freightCurrency: 'PREPAID',
            },
          },
        })}
      />,
    );

    expect(screen.getByText('PREPAID · 3.200,00 (moeda não informada)')).toBeInTheDocument();
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

    // Data de calendario: o dia exibido e o dia do documento, sem tolerancia de
    // fuso (a expectativa antiga aceitava 09 ou 10/02 para um BL de 10/02).
    expect(screen.getByText('10/02/2026')).toBeInTheDocument();
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

    expect(screen.getByText('08/02/2026')).toBeInTheDocument();
  });

  /**
   * Decisao D3 da reuniao de 11/09: "puxar da follow-up o que tiver la e depois
   * so atualizar", com o valor do documento visivel como divergencia.
   */
  describe('precedencia por campo (follow-up x documento)', () => {
    const processoComFollowUp = {
      exporterName: 'KIOM GLOBAL LIMITED',
      portOfLoading: 'SHENZHEN',
      portOfDischarge: 'ITAPOA',
      totalFobValue: '101346.01',
      totalCbm: '120.250',
      containerType: "40'NOR",
      etd: '2026-08-08',
    } satisfies Partial<ImportProcess>;

    it('mostra o FOB da follow-up com selo e a divergencia da invoice', () => {
      render(
        <ProcessInfoCard
          process={makeProcess({
            ...processoComFollowUp,
            aiExtractedData: { invoice: { totalFobValue: 101246.01 } },
          })}
        />,
      );

      expect(screen.getByText('US$ 101.346,01')).toBeInTheDocument();
      expect(screen.getByText(/Invoice: US\$ 101\.246,01/)).toBeInTheDocument();
      expect(screen.getAllByTitle('Fonte: Follow-up').length).toBeGreaterThanOrEqual(1);
    });

    it('nao inventa divergencia quando os valores batem', () => {
      render(
        <ProcessInfoCard
          process={makeProcess({
            ...processoComFollowUp,
            aiExtractedData: { invoice: { totalFobValue: 101346.01, portOfLoading: 'shenzhen' } },
          })}
        />,
      );

      expect(screen.queryByText(/Invoice: US\$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Invoice: shenzhen/)).not.toBeInTheDocument();
    });

    it('usa o ETD da follow-up na Data Embarque quando nao ha documento', () => {
      render(<ProcessInfoCard process={makeProcess(processoComFollowUp)} />);
      expect(screen.getByText('08/08/2026')).toBeInTheDocument();
    });

    it('importador e pesos continuam vindo do documento (a follow-up nao os tem)', () => {
      render(
        <ProcessInfoCard
          process={makeProcess({
            ...processoComFollowUp,
            aiExtractedData: {
              invoice: { importerName: 'IMB TEXTIL S.A.', totalNetWeight: 12560.68 },
              packing_list: { totalNetWeight: 12560.68, totalBoxes: 1375 },
            },
          })}
        />,
      );

      expect(screen.getByText('IMB TEXTIL S.A.')).toBeInTheDocument();
      expect(screen.getByText('1375')).toBeInTheDocument();
      expect(screen.getAllByTitle('Fonte: Packing List').length).toBeGreaterThanOrEqual(1);
    });

    it('prefere o CBM do packing list quando a follow-up nao tem', () => {
      render(
        <ProcessInfoCard
          process={makeProcess({
            aiExtractedData: {
              invoice: { totalCbm: 65.527 },
              packing_list: { totalCbm: 65.53 },
            },
          })}
        />,
      );

      expect(screen.getByText('65.530 m3')).toBeInTheDocument();
    });
  });

  /**
   * O espelho auto-gerado e uma copia da propria invoice/PL montada pelo
   * sistema (build-espelho.ts). A usuaria via "Espelho" na capa de um processo
   * em que nao tinha subido espelho nenhum.
   */
  it('nao rotula como Espelho o resumo gerado automaticamente', () => {
    render(
      <ProcessInfoCard
        process={makeProcess({
          aiExtractedData: {
            espelho: {
              summary: {
                generatedBy: 'auto_deterministic',
                exporterName: 'KIOM GLOBAL LIMITED',
                totalBoxes: 42,
              },
              items: [{ fornecedor: 'FORNECEDOR ESPELHO' }],
            },
          },
        })}
      />,
    );

    expect(screen.queryByTitle('Fonte: Espelho')).not.toBeInTheDocument();
    expect(screen.queryByText('FORNECEDOR ESPELHO')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });
});
