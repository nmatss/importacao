import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';
import { dateRangeBounds } from '../../../__tests__/helpers/sql-inspect.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({ db: mockDb }));
vi.mock('../../audit/service.js', () => ({ auditService: { log: vi.fn() } }));

const chat = vi.hoisted(() => ({
  sendToGoogleChat: vi.fn().mockResolvedValue(true),
  isChatCooldownActive: vi.fn(() => false),
}));
vi.mock('../google-chat.service.js', () => chat);

vi.mock('../../../shared/metrics/index.js', () => ({
  alertDeliveryTotal: { inc: vi.fn() },
}));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { alertService } = await import('../service.js');

const WEBHOOK = 'https://chat.googleapis.com/v1/spaces/AAA/messages?key=k&token=t';

beforeEach(() => {
  vi.clearAllMocks();
  queryQueue.length = 0;
  chat.sendToGoogleChat.mockResolvedValue(true);
});

/**
 * O resumo diario pulava dias e chegava com numeros velhos: 6509 foi criado em
 * 06/09 12:00:00.369 e entregue em 07/09 12:00:01.437 — domingo, com a contagem
 * de sabado. Causa: dedupe por janela DESLIZANTE de 24h num job de periodo 24h.
 * Se a execucao de hoje dispara alguns milissegundos antes do instante de
 * ontem, o de ontem "ainda esta na janela", o de hoje nao nasce e o caminho de
 * duplicata reentrega o registro velho.
 */
describe('dedupeBy: local-day', () => {
  it('a janela e o dia civil do operador, nao 24h para tras', async () => {
    queryQueue.push(createResolvedChain([])); // temDuplicado: nada hoje
    queryQueue.push(createResolvedChain([{ id: 1, title: 'Processos sem movimentação' }]));
    queryQueue.push(createResolvedChain([])); // webhook

    await alertService.create({
      severity: 'warning',
      title: 'Processos sem movimentação',
      message: 'texto de hoje',
      dedupeBy: 'local-day',
    });

    const where = mockDb.select.mock.results[0].value.where.mock.calls[0][0];
    const { start } = dateRangeBounds(where);
    expect(start).not.toBeNull();
    // Meia-noite em America/Sao_Paulo = 03:00 UTC.
    expect(start!.toISOString().endsWith('T03:00:00.000Z')).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('duas execucoes no mesmo dia geram um alerta so', async () => {
    queryQueue.push(createResolvedChain([{ id: 9, message: 'texto de hoje' }]));
    queryQueue.push(
      createResolvedChain([
        { id: 9, message: 'texto de hoje', sentToChat: true, createdAt: new Date() },
      ]),
    );

    const resultado = await alertService.create({
      severity: 'warning',
      title: 'Processos sem movimentação',
      message: 'texto de hoje',
      dedupeBy: 'local-day',
    });

    expect(resultado).toMatchObject({ id: 9 });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('registro de ONTEM nao e reentregue hoje: o conteudo esta vencido', async () => {
    const ontem = new Date(Date.now() - 30 * 60 * 60 * 1000);
    queryQueue.push(createResolvedChain([{ id: 9, message: 'texto de ontem' }]));
    queryQueue.push(
      createResolvedChain([
        { id: 9, message: 'texto de ontem', sentToChat: false, createdAt: ontem },
      ]),
    );

    await alertService.create({
      severity: 'warning',
      title: 'Processos sem movimentação',
      message: 'texto de ontem',
      dedupeBy: 'local-day',
    });

    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();
  });

  it('registro de HOJE ainda nao entregue continua sendo tentado', async () => {
    queryQueue.push(createResolvedChain([{ id: 9, message: 'texto de hoje' }]));
    queryQueue.push(
      createResolvedChain([
        {
          id: 9,
          message: 'texto de hoje',
          sentToChat: false,
          deliveryAttempts: 0,
          createdAt: new Date(),
        },
      ]),
    );
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    queryQueue.push(createResolvedChain([]));

    await alertService.create({
      severity: 'warning',
      title: 'Processos sem movimentação',
      message: 'texto de hoje',
      dedupeBy: 'local-day',
    });

    expect(chat.sendToGoogleChat).toHaveBeenCalledTimes(1);
  });
});

/**
 * A reuniao quer MANTER a mensagem de alteracao, sem que reprocessar o mesmo
 * documento repita o aviso: em 11/09, PK2192607SZ rendeu 4 mensagens de
 * "Validacao com Falhas", uma por reprocessamento, com o mesmo conjunto de
 * falhas.
 */
describe('dedupeBy: change', () => {
  it('mesmo conteudo nao cria alerta novo, sem janela de tempo', async () => {
    queryQueue.push(createResolvedChain([{ id: 4, message: 'as mesmas 5 falhas' }]));
    queryQueue.push(
      createResolvedChain([{ id: 4, message: 'as mesmas 5 falhas', sentToChat: true }]),
    );

    const resultado = await alertService.create({
      processId: 287,
      severity: 'warning',
      title: 'Falhas na Validacao',
      message: 'as mesmas 5 falhas',
      dedupeBy: 'change',
    });

    expect(resultado).toMatchObject({ id: 4 });
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(chat.sendToGoogleChat).not.toHaveBeenCalled();
  });

  it('conjunto de falhas diferente volta a avisar', async () => {
    queryQueue.push(createResolvedChain([{ id: 4, message: 'as mesmas 5 falhas' }]));
    queryQueue.push(createResolvedChain([{ id: 5, message: 'agora sao 3 falhas' }]));
    queryQueue.push(createResolvedChain([{ value: WEBHOOK }]));
    queryQueue.push(createResolvedChain([]));

    await alertService.create({
      processId: 287,
      severity: 'warning',
      title: 'Falhas na Validacao',
      message: 'agora sao 3 falhas',
      dedupeBy: 'change',
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(chat.sendToGoogleChat).toHaveBeenCalledTimes(1);
  });

  it('sem alerta anterior, cria', async () => {
    queryQueue.push(createResolvedChain([]));
    queryQueue.push(createResolvedChain([{ id: 6, message: 'primeira vez' }]));
    queryQueue.push(createResolvedChain([]));

    await alertService.create({
      processId: 287,
      severity: 'critical',
      title: 'Falhas na Validacao (Critico)',
      message: 'primeira vez',
      dedupeBy: 'change',
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });
});
