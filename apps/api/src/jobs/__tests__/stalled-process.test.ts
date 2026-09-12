import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../shared/database/connection.js', () => ({ db: mockDb }));
vi.mock('../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const alerts = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: 1 }),
  hasDuplicateRecent: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../modules/alerts/service.js', () => ({ alertService: alerts }));

const {
  DIAS_UTEIS_ENTRE_AVISOS,
  TITULO_DIGEST,
  avaliarProcesso,
  checkStalledProcesses,
  codigosDoDigest,
  filtrarPorCadencia,
  montarMensagemDigest,
  severidadePorAtraso,
} = await import('../stalled-process.js');

/**
 * O job media "updated_at antigo", que na carteira real e o estado NORMAL: em
 * 11/09, 22 dos 28 processos ativos tinham o MESMO `updated_at` (25/08 17:30
 * UTC), carimbado em massa pelo `logistic-sync`. Resultado medido: 26 cards em
 * ~30s as 09:00 de 09/09 e 32 das 52 mensagens da semana sendo inatividade.
 *
 * A regra agora pergunta se o processo esta fora do esperado para a FASE.
 */
const SEXTA = new Date('2026-09-11T12:00:00Z'); // sexta, 09:00 BRT

function processo(over: Partial<Parameters<typeof avaliarProcesso>[0]> = {}) {
  return {
    id: 1,
    processCode: 'PK2132607SZ',
    status: 'validating',
    updatedAt: new Date('2026-08-25T17:30:00Z'),
    eta: null,
    registeredAt: null,
    customsClearanceAt: null,
    lockedAt: null,
    ...over,
  };
}

describe('elegibilidade do processo parado', () => {
  it('EM TRANSITO nao e parado, mesmo com updated_at antigo', () => {
    // O caso dos 24 processos de 11/09 com ETA entre 12/09 e 25/10: nada e
    // esperado do time enquanto o navio nao atraca.
    const avaliacao = avaliarProcesso(processo({ eta: '2026-10-25' }), SEXTA);
    expect(avaliacao.elegivel).toBe(false);
    expect(avaliacao).toMatchObject({ silenciadoPor: 'em_transito' });
  });

  it('ETA de hoje ainda e transito: o dia da atracacao nao cobra registro', () => {
    expect(avaliarProcesso(processo({ eta: '2026-09-11' }), SEXTA)).toMatchObject({
      elegivel: false,
      silenciadoPor: 'em_transito',
    });
  });

  it('ETA passada sem registro E parado, contado em dias uteis', () => {
    const avaliacao = avaliarProcesso(processo({ eta: '2026-09-04' }), SEXTA);
    expect(avaliacao).toMatchObject({
      elegivel: true,
      parado: { motivo: 'eta_sem_registro', diasUteis: 5, severidade: 'warning' },
    });
  });

  it('registro feito silencia o processo', () => {
    expect(
      avaliarProcesso(
        processo({ eta: '2026-09-04', registeredAt: new Date('2026-09-08T12:00:00Z') }),
        SEXTA,
      ),
    ).toMatchObject({ elegivel: false, silenciadoPor: 'registrado' });
    expect(
      avaliarProcesso(
        processo({ eta: '2026-09-04', customsClearanceAt: new Date('2026-09-09T12:00:00Z') }),
        SEXTA,
      ),
    ).toMatchObject({ elegivel: false, silenciadoPor: 'registrado' });
  });

  it('processo travado e encerrado nao entram', () => {
    expect(
      avaliarProcesso(
        processo({ eta: '2026-09-04', lockedAt: new Date('2026-09-05T12:00:00Z') }),
        SEXTA,
      ),
    ).toMatchObject({ elegivel: false, silenciadoPor: 'travado' });
    for (const status of ['completed', 'cancelled']) {
      expect(avaliarProcesso(processo({ eta: '2026-09-04', status }), SEXTA)).toMatchObject({
        elegivel: false,
        silenciadoPor: 'encerrado',
      });
    }
  });

  it('sem ETA sobra a inatividade pura, a partir de 3 dias uteis', () => {
    expect(
      avaliarProcesso(processo({ updatedAt: new Date('2026-09-09T12:00:00Z') }), SEXTA),
    ).toMatchObject({ elegivel: false, silenciadoPor: 'dentro_do_prazo' });
    expect(
      avaliarProcesso(processo({ updatedAt: new Date('2026-09-08T12:00:00Z') }), SEXTA),
    ).toMatchObject({
      elegivel: true,
      parado: { motivo: 'sem_previsao', diasUteis: 3 },
    });
  });

  /**
   * A ETA vem da Follow Up, e a reuniao de 11/09 reportou datas erradas (ETA de
   * atracacao pegando 'ETA Previsto Medio' com um dia a menos). Uma ETA errada
   * para FRENTE silenciaria um processo atrasado para sempre — por isso o teto.
   */
  it('TETO: em transito ha 30 dias uteis sem atualizacao volta a aparecer', () => {
    const avaliacao = avaliarProcesso(
      processo({ eta: '2026-12-01', updatedAt: new Date('2026-07-01T12:00:00Z') }),
      SEXTA,
    );
    expect(avaliacao).toMatchObject({
      elegivel: true,
      parado: { motivo: 'teto_absoluto', severidade: 'warning' },
    });
  });

  it('o fim de semana nao empurra o contador', () => {
    // ETA na sexta 04/09; segunda 07/09 e 1 dia util, nao 3.
    expect(
      avaliarProcesso(processo({ eta: '2026-09-04' }), new Date('2026-09-07T12:00:00Z')),
    ).toMatchObject({ elegivel: true, parado: { diasUteis: 1 } });
  });

  it('escala para critico com 10 dias uteis apos a ETA', () => {
    expect(severidadePorAtraso(9)).toBe('warning');
    expect(severidadePorAtraso(10)).toBe('critical');
    expect(avaliarProcesso(processo({ eta: '2026-08-27' }), SEXTA)).toMatchObject({
      elegivel: true,
      parado: { diasUteis: 11, severidade: 'critical' },
    });
  });

  /**
   * Cenario real de 11/09: 28 processos ativos, 24 em transito (ETA de 12/09 a
   * 25/10) e 4 com ETA em 06/09 sem registro. O antigo alertava os 28.
   */
  it('cenario de 11/09: dos 28 ativos, 4 sao parados', () => {
    const emTransito = Array.from({ length: 24 }, (_, i) =>
      processo({ id: i + 1, processCode: `TR${i}`, eta: '2026-10-01' }),
    );
    const atracadosSemRegistro = ['IM0752606NB', 'PK2132607SZ', 'PK2092606SZ', 'PK2112606NB'].map(
      (codigo, i) => processo({ id: 100 + i, processCode: codigo, eta: '2026-09-06' }),
    );

    const parados = [...emTransito, ...atracadosSemRegistro]
      .map((p) => avaliarProcesso(p, SEXTA))
      .filter((a) => a.elegivel);

    expect(parados).toHaveLength(4);
  });
});

describe('cadencia do digest', () => {
  const parado = {
    id: 1,
    processCode: 'PK2132607SZ',
    motivo: 'eta_sem_registro' as const,
    diasUteis: 5,
    severidade: 'warning' as const,
  };

  it('processo nunca avisado entra', () => {
    expect(filtrarPorCadencia([parado], [], SEXTA)).toHaveLength(1);
  });

  it('processo avisado ha menos de 5 dias uteis nao repete', () => {
    const anterior = {
      createdAt: new Date('2026-09-09T12:00:00Z'),
      message: montarMensagemDigest([parado], 1),
    };
    expect(filtrarPorCadencia([parado], [anterior], SEXTA)).toEqual([]);
  });

  it('passados 5 dias uteis, volta', () => {
    const anterior = {
      createdAt: new Date('2026-09-04T12:00:00Z'),
      message: montarMensagemDigest([parado], 1),
    };
    expect(filtrarPorCadencia([parado], [anterior], SEXTA)).toHaveLength(1);
  });

  it('ESCALADA fura a espera: virou critico depois do ultimo aviso', () => {
    const anterior = {
      createdAt: new Date('2026-09-09T12:00:00Z'),
      message: montarMensagemDigest([{ ...parado, diasUteis: 8 }], 1),
    };
    const agoraCritico = { ...parado, diasUteis: 10, severidade: 'critical' as const };
    expect(filtrarPorCadencia([agoraCritico], [anterior], SEXTA)).toHaveLength(1);
  });

  it('critico que JA era critico no ultimo aviso respeita a espera', () => {
    const anterior = {
      createdAt: new Date('2026-09-10T12:00:00Z'),
      message: montarMensagemDigest([{ ...parado, diasUteis: 14 }], 1),
    };
    const aindaCritico = { ...parado, diasUteis: 15, severidade: 'critical' as const };
    expect(filtrarPorCadencia([aindaCritico], [anterior], SEXTA)).toEqual([]);
  });

  it('a mensagem publicada e relida pelo proprio job', () => {
    // Contrato entre montarMensagemDigest e codigosDoDigest: o estado da
    // cadencia mora na mensagem ja gravada, e e por isso que a regra dispensa
    // migration.
    const mensagem = montarMensagemDigest(
      [parado, { ...parado, id: 2, processCode: 'IM0752606NB' }],
      2,
    );
    expect(codigosDoDigest(mensagem)).toEqual(['PK2132607SZ', 'IM0752606NB']);
  });

  it('mensagem de outro formato nao derruba a leitura', () => {
    expect(codigosDoDigest('qualquer coisa')).toEqual([]);
    expect(codigosDoDigest('')).toEqual([]);
  });
});

describe('mensagem do digest', () => {
  it('fala em portugues, sem chave tecnica, e cita a cadencia', () => {
    const mensagem = montarMensagemDigest(
      [
        {
          id: 1,
          processCode: 'PK2132607SZ',
          motivo: 'eta_sem_registro',
          diasUteis: 5,
          severidade: 'warning',
        },
      ],
      4,
    );
    expect(mensagem).toContain('PK2132607SZ');
    expect(mensagem).toContain('registro de DI/DUIMP');
    expect(mensagem).toContain('Outros 3');
    expect(mensagem).not.toMatch(/eta_sem_registro|updatedAt|processCode/);
  });

  it('um dia util no singular', () => {
    const mensagem = montarMensagemDigest(
      [
        {
          id: 1,
          processCode: 'PK2132607SZ',
          motivo: 'teto_absoluto',
          diasUteis: 1,
          severidade: 'warning',
        },
      ],
      1,
    );
    expect(mensagem).toContain('1 dia útil');
    expect(mensagem).not.toContain('1 dias úteis');
  });
});

describe('checkStalledProcesses()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
    alerts.create.mockResolvedValue({ id: 1 });
  });

  it('nao roda no fim de semana', async () => {
    const resultado = await checkStalledProcesses(new Date('2026-09-12T12:00:00Z'));

    expect(resultado).toMatchObject({ digest: false, pulado: 'fim_de_semana' });
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(alerts.create).not.toHaveBeenCalled();
  });

  /**
   * Regressao de VOLUME: era este o defeito. 26 processos com o mesmo
   * `updated_at` produziam 26 cards individuais em ~30 segundos.
   */
  it('26 processos parados geram UMA mensagem, nenhum card individual', async () => {
    const linhas = Array.from({ length: 26 }, (_, i) =>
      processo({ id: i + 1, processCode: `P${i}`, eta: '2026-09-04' }),
    );
    queryQueue.push(createResolvedChain(linhas));
    queryQueue.push(createResolvedChain([])); // nenhum digest anterior

    const resultado = await checkStalledProcesses(SEXTA);

    expect(resultado).toMatchObject({ parados: 26, avisados: 26, digest: true });
    expect(alerts.create).toHaveBeenCalledTimes(1);
    const chamada = alerts.create.mock.calls[0][0];
    expect(chamada.processId).toBeUndefined();
    expect(chamada.title).toBe(TITULO_DIGEST);
    expect(chamada.dedupeBy).toBe('local-day');
    expect(chamada.severity).toBe('warning');
  });

  it('conjunto sem novidade nao posta nada', async () => {
    const linhas = [processo({ eta: '2026-09-04' })];
    queryQueue.push(createResolvedChain(linhas));
    queryQueue.push(
      createResolvedChain([
        {
          createdAt: new Date('2026-09-10T12:00:00Z'),
          message: montarMensagemDigest(
            [
              {
                id: 1,
                processCode: 'PK2132607SZ',
                motivo: 'eta_sem_registro',
                diasUteis: 4,
                severidade: 'warning',
              },
            ],
            1,
          ),
        },
      ]),
    );

    const resultado = await checkStalledProcesses(SEXTA);

    expect(resultado).toMatchObject({ parados: 1, avisados: 0, digest: false });
    expect(alerts.create).not.toHaveBeenCalled();
  });

  it('processo novo no conjunto posta de novo', async () => {
    const linhas = [
      processo({ id: 1, processCode: 'PK2132607SZ', eta: '2026-09-04' }),
      processo({ id: 2, processCode: 'IM0752606NB', eta: '2026-09-04' }),
    ];
    queryQueue.push(createResolvedChain(linhas));
    queryQueue.push(
      createResolvedChain([
        {
          createdAt: new Date('2026-09-10T12:00:00Z'),
          message: 'Processos: PK2132607SZ',
        },
      ]),
    );

    const resultado = await checkStalledProcesses(SEXTA);

    expect(resultado).toMatchObject({ avisados: 1, digest: true });
    expect(alerts.create.mock.calls[0][0].message).toContain('IM0752606NB');
    expect(codigosDoDigest(alerts.create.mock.calls[0][0].message)).toEqual(['IM0752606NB']);
  });

  it('digest com processo critico sai como critical', async () => {
    queryQueue.push(createResolvedChain([processo({ eta: '2026-08-27' })]));
    queryQueue.push(createResolvedChain([]));

    await checkStalledProcesses(SEXTA);

    expect(alerts.create.mock.calls[0][0].severity).toBe('critical');
  });

  it('nada parado, nada enviado', async () => {
    queryQueue.push(createResolvedChain([processo({ eta: '2026-10-01' })]));
    queryQueue.push(createResolvedChain([]));

    const resultado = await checkStalledProcesses(SEXTA);

    expect(resultado).toMatchObject({ parados: 0, avisados: 0, digest: false });
    expect(alerts.create).not.toHaveBeenCalled();
  });

  it('a cadencia publicada e a mesma que a mensagem promete', () => {
    expect(DIAS_UTEIS_ENTRE_AVISOS).toBe(5);
  });
});
