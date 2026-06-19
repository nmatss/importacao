import { describe, expect, it } from 'vitest';
import type { ImportProcess } from '@/shared/types';
import { buildLogisticProps, deriveLogisticStep } from './LogisticStatusBar';

const IN_TRANSIT_STEP = 2; // LOGISTIC_STAGES index for 'in_transit' / 'Em Transito'

function makeProcess(overrides: Partial<ImportProcess> = {}): ImportProcess {
  return {
    id: 1,
    processCode: 'IMP-001',
    brand: 'puket',
    status: 'draft',
    logisticStatus: null,
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
  } as ImportProcess;
}

describe('buildLogisticProps', () => {
  it('feeds espelho.summary etd/shipmentDate when process fields are null', () => {
    const props = buildLogisticProps(
      makeProcess({
        aiExtractedData: {
          espelho: {
            summary: {
              etd: '2026-02-08T00:00:00.000Z',
              eta: '2026-03-01T00:00:00.000Z',
              shipmentDate: '2026-02-10T00:00:00.000Z',
            },
            items: [],
          },
        },
      }),
    );

    expect(props.etd).toBe('2026-02-08T00:00:00.000Z');
    expect(props.eta).toBe('2026-03-01T00:00:00.000Z');
    expect(props.shipmentDate).toBe('2026-02-10T00:00:00.000Z');
  });

  it('keeps process-level fields when present (no espelho override)', () => {
    const props = buildLogisticProps(
      makeProcess({
        etd: '2026-05-01T00:00:00.000Z',
        aiExtractedData: {
          espelho: { summary: { etd: '2026-02-08T00:00:00.000Z' }, items: [] },
        },
      }),
    );

    expect(props.etd).toBe('2026-05-01T00:00:00.000Z');
  });

  it('yields Em Transito when the BL espelho ETD is in the past', () => {
    const props = buildLogisticProps(
      makeProcess({
        aiExtractedData: {
          espelho: { summary: { etd: '2026-02-08T00:00:00.000Z' }, items: [] },
        },
      }),
    );

    expect(deriveLogisticStep(props)).toBe(IN_TRANSIT_STEP);
  });

  it('does not advance to Em Transito when there is no espelho/process shipping data', () => {
    const props = buildLogisticProps(makeProcess());
    expect(deriveLogisticStep(props)).toBe(0);
  });
});
