import { describe, it, expect, afterEach } from 'vitest';
import { envTexto, envNumeroPositivo } from '../env.js';

/**
 * O caso que motiva este modulo: o `docker-compose` escreve `${VAR:-}`, que
 * passa string VAZIA ao container quando a variavel nao existe no `.env`. Com
 * `process.env.X ?? 'padrao'`, o vazio VENCE o padrao — e num teto de custo,
 * `Number('')` e `0`, que significa DESATIVADO. Repassar a variavel desligava o
 * controle em vez de aplica-lo.
 */
const NOME = 'TESTE_ENV_UTIL';

afterEach(() => {
  delete process.env[NOME];
});

describe('envTexto()', () => {
  it('string VAZIA cai no padrao — o `??` nao fazia isso', () => {
    process.env[NOME] = '';
    expect(envTexto(NOME, 'padrao')).toBe('padrao');
    // A contraprova do defeito, para nao se perder o motivo:
    expect(process.env[NOME] ?? 'padrao').toBe('');
  });

  it('so espaco tambem cai no padrao', () => {
    process.env[NOME] = '   ';
    expect(envTexto(NOME, 'padrao')).toBe('padrao');
  });

  it('ausente cai no padrao', () => {
    expect(envTexto(NOME, 'padrao')).toBe('padrao');
  });

  it('valor real vence o padrao', () => {
    process.env[NOME] = 'definido';
    expect(envTexto(NOME, 'padrao')).toBe('definido');
  });
});

describe('envNumeroPositivo()', () => {
  it.each([
    ['vazio', ''],
    ['espaco', ' '],
    ['nao numerico', 'abc'],
    ['zero', '0'],
    ['negativo', '-3'],
  ])('%s cai no padrao', (_nome, valor) => {
    process.env[NOME] = valor;
    expect(envNumeroPositivo(NOME, 42)).toBe(42);
  });

  it('numero positivo vence o padrao', () => {
    process.env[NOME] = '7';
    expect(envNumeroPositivo(NOME, 42)).toBe(7);
  });
});
