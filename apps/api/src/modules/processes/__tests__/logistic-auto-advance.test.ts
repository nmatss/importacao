import { describe, it, expect } from 'vitest';
import {
  deriveLogisticStatus,
  logisticStatusFromSheet,
  shouldApplyDerivedStatus,
} from '../logistic-auto-advance.js';

// Datas previstas nao comprovam eventos, mesmo vencidas. A etapa depende
// de marco realizado ou status confirmado na fonte follow-up.

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
  it('does not invent departure when a planned ETD expires', () => {
    const status = deriveLogisticStatus({
      process: { ...baseProcess, etd: new Date('2026-02-10T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('consolidation');
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

  it('elapsed ETA does not prove berthing', () => {
    const status = deriveLogisticStatus({
      process: {
        ...baseProcess,
        etd: new Date('2026-02-10T00:00:00Z'),
        eta: new Date('2026-03-15T00:00:00Z'),
      },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('consolidation');
  });
});

/**
 * Reuniao 11/09: o IM0762607NB aparecia como "Ag. Entrada" com a planilha
 * dizendo "Em transito para Itapoa" e a chegada no CD prevista para 15/10.
 * `cd_arrival_at` vem da coluna 'Chegada CD', que e PREVISAO enquanto a carga
 * nao chega.
 */
describe('deriveLogisticStatus — previsao nao e evento realizado', () => {
  const baseFuturo = { ...baseProcess, shipmentDate: '2026-02-10' };

  it('nao vai para waiting_entry com Chegada CD no futuro', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, cdArrivalAt: new Date('2026-10-15T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
  });

  it('chegada CD prevista no passado nao comprova chegada', () => {
    const status = deriveLogisticStatus({
      process: { ...baseFuturo, cdArrivalAt: new Date('2026-06-10T00:00:00Z') },
      followUp: null,
      now: NOW,
    });
    expect(status).toBe('in_transit');
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
    expect(status).toBe('consolidation');
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

describe('marcos realizados no calendario de Sao Paulo', () => {
  it.each(['shipmentDate', 'etaActual'] as const)('%s nao acontece na vespera local', (field) => {
    const process = { ...baseProcess, [field]: '2026-09-12' };
    expect(
      deriveLogisticStatus({ process, followUp: null, now: new Date('2026-09-12T02:59:59Z') }),
    ).toBe('consolidation');
    expect(
      deriveLogisticStatus({ process, followUp: null, now: new Date('2026-09-12T03:00:00Z') }),
    ).toBe(field === 'shipmentDate' ? 'in_transit' : 'berthing');
  });
  it('ignora data de calendario impossivel', () => {
    expect(
      deriveLogisticStatus({
        process: { ...baseProcess, etaActual: '2026-02-30' },
        followUp: null,
        now: NOW,
      }),
    ).toBe('consolidation');
  });
});

describe('status textual e numero nao comprovam evento negado ou futuro', () => {
  it.each([
    'Aguardando liberação',
    'Aguardando atracação',
    'Não registrado',
    'Sem canal',
    'Atracação prevista',
  ])('%s nao declara evento realizado', (text) => {
    expect(logisticStatusFromSheet(text, '2026-06-20T12:00:00Z')).toBeNull();
  });
  it('ignora timestamp de sincronizacao invalido', () => {
    expect(logisticStatusFromSheet('Atracado', 'invalido')).toBeNull();
  });
  it.each([null, '2026-12-01'])(
    'numero DUIMP com data %s nao comprova registro',
    (registeredAt) => {
      expect(
        deriveLogisticStatus({
          process: { ...baseProcess, duimpNumber: '26BR000001', registeredAt },
          followUp: null,
          now: NOW,
        }),
      ).toBe('consolidation');
    },
  );
});
