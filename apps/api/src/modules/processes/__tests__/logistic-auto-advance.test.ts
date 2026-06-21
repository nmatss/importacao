import { describe, it, expect } from 'vitest';
import { deriveLogisticStatus } from '../logistic-auto-advance.js';

// Regression coverage for Eduarda's feedback: a process whose BL/Invoice carries
// an ETD in the past must auto-advance the Ciclo de Transporte to "em trânsito".
// Closes the audit gap that the end-to-end logic had no test proving it.

const baseProcess = {
  etd: null,
  eta: null,
  shipmentDate: null,
  customsChannel: null,
  diNumber: null,
  customsClearanceAt: null,
  cdArrivalAt: null,
  logisticStatus: null,
  status: 'active',
};

const NOW = new Date('2026-06-21T00:00:00Z');

describe('deriveLogisticStatus — em trânsito (in_transit)', () => {
  it('advances to in_transit when ETD is in the past (embarque de fevereiro)', () => {
    const status = deriveLogisticStatus({
      process: { ...baseProcess, etd: new Date('2026-02-10T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('falls back to shipmentDate when etd is absent', () => {
    const status = deriveLogisticStatus({
      process: { ...baseProcess, shipmentDate: '2026-02-10' },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('does NOT advance to in_transit when ETD is still in the future', () => {
    const status = deriveLogisticStatus({
      process: { ...baseProcess, etd: new Date('2026-12-01T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).not.toBe('in_transit');
  });

  it('berthing takes precedence once ETA is reached', () => {
    const status = deriveLogisticStatus({
      process: {
        ...baseProcess,
        etd: new Date('2026-02-10T00:00:00Z'),
        eta: new Date('2026-03-15T00:00:00Z'),
      },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('berthing');
  });
});
