import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));

const readProcessSheetMatrix = vi.fn();
vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: { readProcessSheetMatrix },
}));

vi.mock('../../audit/service.js', () => ({ auditService: { log: vi.fn() } }));
vi.mock('../../../shared/utils/process-events.js', () => ({ recordProcessEvent: vi.fn() }));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { diffProcessAgainstRow, indexSheetRows, renderDiff, runFollowUpSheetSync } =
  await import('../sheet-sync.js');
const { indexRowByHeader, findMissingColumns } = await import('../sheet-columns.js');

/**
 * Cabecalho e linha REAIS da aba Processos (PK2192607SZ, lidos em 11/09/2026).
 *
 * A coluna 'ETA Previsto Medio' (17/09) esta aqui de proposito: e ela que a
 * tela mostrava como atracacao enquanto as tres datas reais diziam 08/09.
 */
const HEADERS = [
  'Processos',
  'Status',
  'Fornecedor/ Supplier',
  'B/L',
  'ETD ORIGEM*',
  'Porto de Embarque',
  'Porto de Destino',
  'Valor Invoice (USD)',
  'Frete (USD)',
  'Container',
  'No Ctnr',
  'CBM',
  'ETA Previsto Médio',
  'ETA Armador*',
  'ETA Final*',
  'ETA Realizado',
  'Número de Registro DI / DUIMP',
  'Data Registro DI / DUIMP',
  'Canal',
  'Desembaraço',
  'Chegada CD',
];

const ROW_219 = [
  'PK2192607SZ',
  'Aguardando Entrada',
  'KIOM GLOBAL LIMITED',
  'OERU4299877',
  '07/08/2026',
  'SHENZHEN',
  'ITAPOA',
  '$85.313,93',
  '10.000,00',
  "40'NOR",
  '1',
  '65,527',
  '17/09/2026',
  '08/09/2026',
  '08/09/2026',
  '08/09/2026',
  '26BR0001660880-2',
  '04/09/2026',
  'Verde',
  '08/09/2026 12:11:50',
  '11/09/2026',
];

/** Processo 287 como estava no banco: snapshot congelado de 25/08. */
function processo287() {
  return {
    id: 287,
    processCode: 'PK2192607SZ',
    status: 'validated',
    etd: '2026-08-07',
    eta: '2026-09-17',
    etaCarrier: '2026-09-06',
    etaActual: null,
    registeredAt: null,
    customsClearanceAt: null,
    cdArrivalAt: new Date('2026-09-22T00:00:00.000Z'),
    duimpNumber: null,
    diNumber: null,
    customsChannel: null,
    totalFobValue: '85313.93',
    freightValue: '10000.00',
    insuranceValue: null,
    customsValue: null,
    registrationDollar: null,
    totalCbm: '65.527',
    containerType: null,
    containerCount: null,
    freeTimeDays: null,
    numerarioValue: null,
    portOfLoading: 'SHENZHEN',
    portOfDischarge: 'ITAPOA',
    exporterName: 'KIOM GLOBAL LIMITED',
    vesselName: null,
    blNumber: 'OERU4299877',
    shippingLine: null,
    freightAgent: null,
    originCity: null,
    inspectionType: null,
    purchaseRef: null,
    consolidationRef: null,
    aiExtractedData: { sheetStatus: 'Em transito', importedFromSheet: true },
  } as never;
}

function linha(headers: string[], values: string[]) {
  return indexRowByHeader(headers, values);
}

describe('sheet-columns — mapeamento por cabecalho', () => {
  it('usa ETA Final/Realizado e NUNCA ETA Previsto Medio', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    const porCampo = new Map(diff.changes.map((change) => [change.field, change]));

    expect(porCampo.get('eta')).toMatchObject({ from: '2026-09-17', to: '2026-09-08' });
    expect(porCampo.get('etaActual')).toMatchObject({ to: '2026-09-08' });
    expect(porCampo.get('etaCarrier')).toMatchObject({ to: '2026-09-08' });
    // O 17/09 do 'ETA Previsto Medio' nao entra em campo nenhum.
    const valores = diff.changes.map((change) => change.to);
    expect(valores).not.toContain('2026-09-17');
  });

  it('leva numero e data da DUIMP para as colunas que a tela le', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    const porCampo = new Map(diff.changes.map((change) => [change.field, change]));

    expect(porCampo.get('duimpNumber')).toMatchObject({ to: '26BR0001660880-2' });
    // 04/09 em Sao Paulo = 04/09 03:00 UTC. Gravar '2026-09-04T00:00:00Z'
    // (o que o importador fazia) exibia 03/09 na tela.
    expect(porCampo.get('registeredAt')?.to).toBe('2026-09-04T03:00:00.000Z');
    expect(porCampo.get('customsChannel')).toMatchObject({ to: 'Verde' });
    expect(porCampo.get('customsClearanceAt')?.to).toBe('2026-09-08T15:11:50.000Z');
    expect(porCampo.get('diNumber')).toBeUndefined();
  });

  it('corrige a Chegada CD para o dia que a planilha diz', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    const cd = diff.changes.find((change) => change.field === 'cdArrivalAt');
    expect(cd?.from).toBe('2026-09-22T00:00:00.000Z');
    expect(cd?.to).toBe('2026-09-11T03:00:00.000Z');
  });

  it('continua mapeando certo depois de inserir uma coluna no meio', () => {
    const headers = [...HEADERS];
    const values = [...ROW_219];
    headers.splice(5, 0, 'Coluna nova da Eduarda');
    values.splice(5, 0, 'qualquer coisa');

    const diff = diffProcessAgainstRow(processo287(), linha(headers, values));
    const porCampo = new Map(diff.changes.map((change) => [change.field, change]));
    expect(porCampo.get('eta')).toMatchObject({ to: '2026-09-08' });
    expect(porCampo.get('duimpNumber')).toMatchObject({ to: '26BR0001660880-2' });
  });

  it('avisa quando uma coluna esperada sumiu do cabecalho', () => {
    const semEta = HEADERS.filter((header) => header !== 'ETA Final*');
    expect(findMissingColumns(semEta)).toContain('eta');
    expect(findMissingColumns(HEADERS)).not.toContain('eta');
  });

  it('nao avisa sobre a coluna de registro quando o numero e uma DI', () => {
    const values = [...ROW_219];
    values[16] = '26/1234567-8';
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, values));
    expect(diff.unavailable.map((item) => item.field)).not.toContain('duimpNumber');
    expect(diff.changes.find((change) => change.field === 'diNumber')?.to).toBe('26/1234567-8');
  });
});

describe('sheet-sync — indisponivel nunca vira 0 nem apaga', () => {
  it('mantem o FOB anterior quando a celula esta com #ERROR!', () => {
    const values = [...ROW_219];
    values[7] = '#ERROR!';
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, values));

    expect(diff.changes.find((change) => change.field === 'totalFobValue')).toBeUndefined();
    expect(diff.unavailable).toContainEqual(
      expect.objectContaining({
        field: 'totalFobValue',
        reason: expect.stringContaining('#ERROR!'),
      }),
    );
  });

  it('nao grava nada quando a data de registro traz texto livre', () => {
    const values = [...ROW_219];
    values[17] = 'EM TEMPO';
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, values));
    expect(diff.changes.find((change) => change.field === 'registeredAt')).toBeUndefined();
    expect(diff.unavailable).toContainEqual(
      expect.objectContaining({
        field: 'registeredAt',
        reason: expect.stringContaining('EM TEMPO'),
      }),
    );
  });

  it('celula vazia nao vira mudanca nem aviso', () => {
    const values = [...ROW_219];
    values[8] = '';
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, values));
    expect(diff.changes.find((change) => change.field === 'freightValue')).toBeUndefined();
    expect(diff.unavailable.map((item) => item.field)).not.toContain('freightValue');
  });

  it('valor igual ao do banco nao vira mudanca', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    expect(diff.changes.map((change) => change.field)).not.toContain('totalFobValue');
    expect(diff.changes.map((change) => change.field)).not.toContain('portOfLoading');
  });

  it('marca a mudanca do status da planilha', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    expect(diff.sheetStatus).toBe('Aguardando Entrada');
    expect(diff.sheetStatusChanged).toBe(true);
  });
});

describe('indexSheetRows', () => {
  it('indexa por codigo e sinaliza codigo repetido', () => {
    const { byCode, duplicated } = indexSheetRows(HEADERS, [ROW_219, ROW_219]);
    expect(byCode.size).toBe(1);
    expect(duplicated).toEqual(['PK2192607SZ']);
  });
});

describe('renderDiff', () => {
  it('diz explicitamente quando nada foi gravado', () => {
    const diff = diffProcessAgainstRow(processo287(), linha(HEADERS, ROW_219));
    const texto = renderDiff([diff], 'dry_run');
    expect(texto).toContain('simulacao, nada foi gravado');
    expect(texto).toContain('PK2192607SZ');
    expect(texto).toContain('eta: 2026-09-17 -> 2026-09-08 (ETA FINAL)');
  });
});

describe('runFollowUpSheetSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    readProcessSheetMatrix.mockResolvedValue({ headers: HEADERS, rows: [ROW_219] });
  });

  it('off nao le a planilha nem grava', async () => {
    const result = await runFollowUpSheetSync({ mode: 'off' });
    expect(readProcessSheetMatrix).not.toHaveBeenCalled();
    expect(result.totalChanges).toBe(0);
    expect(result.diff).toContain('desligada');
  });

  it('dry_run calcula o diff e NAO grava', async () => {
    queryQueue.push(createResolvedChain([processo287()])); // processos ativos
    queryQueue.push(createResolvedChain([{ processCode: 'PK2192607SZ' }])); // codigos conhecidos

    const result = await runFollowUpSheetSync({ mode: 'dry_run' });

    expect(result.applied).toBe(false);
    expect(result.changedProcesses).toBe(1);
    expect(result.totalChanges).toBeGreaterThan(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('apply grava os campos divergentes', async () => {
    queryQueue.push(createResolvedChain([processo287()]));
    const updateChain = createResolvedChain([]);
    queryQueue.push(updateChain);
    queryQueue.push(createResolvedChain([{ processCode: 'PK2192607SZ' }]));

    const result = await runFollowUpSheetSync({ mode: 'apply' });

    expect(result.applied).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    const patch = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.eta).toBe('2026-09-08');
    expect(patch.etaActual).toBe('2026-09-08');
    expect(patch.duimpNumber).toBe('26BR0001660880-2');
    expect(patch.customsChannel).toBe('Verde');
    expect(patch.cdArrivalAt).toEqual(new Date('2026-09-11T03:00:00.000Z'));
  });

  it('nao inventa processo: codigo da planilha que nao existe aqui e so relatado', async () => {
    queryQueue.push(createResolvedChain([])); // nenhum processo ativo casou
    queryQueue.push(createResolvedChain([])); // nenhum codigo conhecido

    const result = await runFollowUpSheetSync({ mode: 'dry_run' });

    expect(result.matchedProcesses).toBe(0);
    expect(result.unknownCodes).toEqual(['PK2192607SZ']);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
