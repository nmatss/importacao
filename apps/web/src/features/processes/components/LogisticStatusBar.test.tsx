import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ImportProcess } from '@/shared/types';
import { buildLogisticProps, deriveLogisticStep, LogisticStatusBar } from './LogisticStatusBar';

const AWAITING_SHIPMENT_STEP = 1; // LOGISTIC_STAGES index for 'Ag. Embarque'
const IN_TRANSIT_STEP = 2; // LOGISTIC_STAGES index for 'in_transit' / 'Em Transito'

const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST_DATE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

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

  it('yields Ag. Embarque (not Em Transito) when the espelho ETD is in the future', () => {
    // build-espelho.ts sets summary.shipmentDate = bl.shipmentDate ?? bl.etd,
    // so a future etd leaks into shipmentDate. It must NOT be treated as a real
    // shipment event — the future-ETD step must win.
    const props = buildLogisticProps(
      makeProcess({
        aiExtractedData: {
          espelho: {
            summary: { etd: FUTURE_DATE, shipmentDate: FUTURE_DATE },
            items: [],
          },
        },
      }),
    );

    expect(props.shipmentDate).toBeNull();
    expect(props.etd).toBe(FUTURE_DATE);
    expect(deriveLogisticStep(props)).toBe(AWAITING_SHIPMENT_STEP);
  });

  it('yields Em Transito for a past espelho ETD with no real shipmentDate', () => {
    const props = buildLogisticProps(
      makeProcess({
        aiExtractedData: {
          espelho: {
            // summary.shipmentDate mirrors the past etd (bl.etd fallback)
            summary: { etd: PAST_DATE, shipmentDate: PAST_DATE },
            items: [],
          },
        },
      }),
    );

    expect(deriveLogisticStep(props)).toBe(IN_TRANSIT_STEP);
  });

  it('does not let the default consolidation status hide a past espelho ETD', () => {
    const props = buildLogisticProps(
      makeProcess({
        logisticStatus: 'consolidation',
        aiExtractedData: {
          espelho: {
            summary: { etd: PAST_DATE, shipmentDate: PAST_DATE },
            items: [],
          },
        },
      }),
    );

    expect(deriveLogisticStep(props)).toBe(IN_TRANSIT_STEP);
  });
});

describe('LogisticStatusBar', () => {
  it('names the mobile carousel controls for assistive technologies', () => {
    render(<LogisticStatusBar {...buildLogisticProps(makeProcess())} />);

    expect(screen.getByRole('button', { name: 'Etapa logística anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima etapa logística' })).toBeEnabled();
  });
});
