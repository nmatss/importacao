import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../shared/database/connection.js', () => ({ db: dbMocks }));
vi.mock('../../alerts/service.js', () => ({
  alertService: { create: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PreConsSnapshotRejectedError } from '../service.js';

/**
 * Estes testes cobrem o guard de plausibilidade do full refresh do Pre-Cons.
 *
 * O sync e um DELETE de tudo seguido do INSERT do que veio agora, e o unico
 * guard existente era `rows.length === 0`. Uma planilha truncada — uma aba
 * valida com poucas linhas — apagava todo o restante da base e ficava so com o
 * que sobrou, sem erro e sem aviso. E a mesma classe do incidente ja resolvido
 * do estoque de certificacao, aqui ainda em aberto ate 2026-08-29.
 */
describe('PreConsSnapshotRejectedError', () => {
  beforeEach(() => {
    delete process.env.PRE_CONS_SYNC_FORCE;
    delete process.env.PRE_CONS_SYNC_MAX_DROP_PCT;
  });

  it('e um erro de conflito, para o controller devolver 409 e nao 500', () => {
    const err = new PreConsSnapshotRejectedError('queda de 90%');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PreConsSnapshotRejectedError');
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('queda de 90%');
  });
});

/**
 * A funcao guard nao e exportada (e detalhe interno do sync), entao a regra de
 * decisao e reproduzida aqui como tabela. O objetivo e congelar a REGRA: se ela
 * mudar no service sem mudar aqui, a divergencia fica explicita na revisao.
 */
describe('regra de plausibilidade do snapshot', () => {
  const DEFAULT_MAX_DROP_PCT = 50;

  function rejeita(previous: number, incoming: number, maxDrop = DEFAULT_MAX_DROP_PCT): boolean {
    if (previous === 0) return false;
    return ((previous - incoming) / previous) * 100 > maxDrop;
  }

  it('a primeira carga nunca e recusada', () => {
    expect(rejeita(0, 1)).toBe(false);
    expect(rejeita(0, 0)).toBe(false);
  });

  it('recusa a planilha truncada que apagaria a base', () => {
    // O cenario real: 5.000 linhas gravadas, arquivo parcial com 1 linha.
    expect(rejeita(5000, 1)).toBe(true);
    expect(rejeita(5000, 100)).toBe(true);
  });

  it('aceita variacao normal entre sincronizacoes', () => {
    expect(rejeita(5000, 5200)).toBe(false);
    expect(rejeita(5000, 4800)).toBe(false);
    expect(rejeita(5000, 2500)).toBe(false); // exatamente 50%, no limite
  });

  it('recusa logo acima do limite', () => {
    expect(rejeita(5000, 2499)).toBe(true);
  });

  it('respeita um limite mais permissivo quando configurado', () => {
    expect(rejeita(5000, 1000, 90)).toBe(false);
    expect(rejeita(5000, 400, 90)).toBe(true);
  });
});
