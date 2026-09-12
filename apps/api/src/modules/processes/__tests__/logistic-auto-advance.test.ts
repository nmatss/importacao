import { describe, it, expect } from 'vitest';
import {
  deriveLogisticStatus,
  logisticStatusFromSheet,
  shouldApplyDerivedStatus,
} from '../logistic-auto-advance.js';

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

/**
 * Reuniao 11/09: o IM0762607NB aparecia como "Ag. Entrada" com a planilha
 * dizendo "Em transito para Itapoa" e a chegada no CD prevista para 15/10.
 * `cd_arrival_at` vem da coluna 'Chegada CD', que e PREVISAO enquanto a carga
 * nao chega.
 */
describe('deriveLogisticStatus — previsao nao e evento realizado', () => {
  const baseFuturo = { ...baseProcess, etd: new Date('2026-02-10T00:00:00Z') };

  it('nao vai para waiting_entry com Chegada CD no futuro', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, cdArrivalAt: new Date('2026-10-15T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('vai para waiting_entry quando a chegada no CD ja passou', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, cdArrivalAt: new Date('2026-06-10T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('waiting_entry');
  });

  it('nao libera no porto com desembaraco futuro', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, customsClearanceAt: new Date('2026-08-01T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('atraca pelo ETA Realizado', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, etaActual: '2026-06-08' },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('berthing');
  });
});

describe('deriveLogisticStatus — coluna Status da planilha', () => {
  it('obedece a planilha quando o status veio da sincronizacao', () => {
    const status = deriveLogisticStatus({
      process: {
        ...baseProcess,
        cdArrivalAt: new Date('2026-06-01T00:00:00Z'),
        sheetStatus: 'Em transito para Itapoa',
        sheetStatusSyncedAt: '2026-06-20T12:00:00.000Z',
      },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('ignora o status do snapshot antigo (sem data de sincronizacao)', () => {
    const status = deriveLogisticStatus({
      process: {
        ...baseProcess,
        cdArrivalAt: new Date('2026-06-01T00:00:00Z'),
        sheetStatus: 'Em transito para Itapoa',
      },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('waiting_entry');
  });

  it('reconhece os textos usados na planilha', () => {
    const syncedAt = '2026-06-20T12:00:00.000Z';
    expect(logisticStatusFromSheet('Aguardando Entrada', syncedAt)).toBe('waiting_entry');
    expect(logisticStatusFromSheet('Em trânsito', syncedAt)).toBe('in_transit');
    expect(logisticStatusFromSheet('Aguardando Embarque', syncedAt)).toBe('waiting_shipment');
    expect(logisticStatusFromSheet('Encerrado', syncedAt)).toBe('internalized');
    expect(logisticStatusFromSheet('texto que ninguem usa', syncedAt)).toBeNull();
  });
});

/**
 * `sentToFeniciaAt` E a etapa "Atualizar Follow-up" (coluna CJ da planilha;
 * `updateFollowUp: 87` em scripts/import-follow-up.js). Marcar essa etapa nao
 * pode empurrar o processo para "Ag. Embarque" como se a invoice tivesse sido
 * enviada a Fenicia.
 */
describe('deriveLogisticStatus — evidencia de envio a Fenicia', () => {
  const semFollowUp = {
    espelhoBuiltAt: null,
    espelhoGeneratedAt: null,
    sentToFeniciaAt: null,
    invoiceSentFeniciaAt: null,
    documentsReceivedAt: null,
  };

  it('"Atualizar Follow-up" sozinho nao avanca para waiting_shipment', () => {
    const status = deriveLogisticStatus({
      process: baseProcess,
      followUp: { ...semFollowUp, sentToFeniciaAt: new Date('2026-06-01T00:00:00Z') },
      now: NOW,
    });
    expect(status).toBe('consolidation');
  });

  it('"Enviar Invoice Fenicia" avanca', () => {
    const status = deriveLogisticStatus({
      process: baseProcess,
      followUp: { ...semFollowUp, invoiceSentFeniciaAt: new Date('2026-06-01T00:00:00Z') },
      now: NOW,
    });
    expect(status).toBe('waiting_shipment');
  });
});

describe('shouldApplyDerivedStatus', () => {
  it('corrige para tras um estagio derivado automaticamente', () => {
    expect(
      shouldApplyDerivedStatus({
        current: 'waiting_entry',
        derived: 'in_transit',
        manualOverride: false,
      }),
    ).toBe(true);
  });

  it('respeita a escolha manual', () => {
    expect(
      shouldApplyDerivedStatus({
        current: 'waiting_entry',
        derived: 'in_transit',
        manualOverride: true,
      }),
    ).toBe(false);
  });

  it('avanca sempre, inclusive por cima de escolha manual', () => {
    expect(
      shouldApplyDerivedStatus({
        current: 'in_transit',
        derived: 'waiting_entry',
        manualOverride: true,
      }),
    ).toBe(true);
  });

  it('nao reescreve o mesmo estagio', () => {
    expect(
      shouldApplyDerivedStatus({
        current: 'in_transit',
        derived: 'in_transit',
        manualOverride: false,
      }),
    ).toBe(false);
  });
});
