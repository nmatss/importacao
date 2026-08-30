import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOME_DE_PARAMETRO_NUMERICO, paramsNumericos } from '../params.js';

/**
 * Guarda ESTATICA, e nao de comportamento: nao existe teste de requisicao capaz
 * de cobrir uma rota que ninguem lembrou de proteger. O defeito e a AUSENCIA de
 * uma declaracao, entao a verificacao tem de varrer o codigo-fonte.
 *
 * Motivo real: em 2026-08-29 havia 81 conversoes `Number(req.params.X)` sem
 * guarda em 12 controllers. O `auth` fazia a mesma coisa escrita de outro jeito
 * (`const { id } = req.params` e `Number(id)` depois), e por isso escapou do
 * primeiro levantamento — prova de que a invariante nao pode depender de COMO o
 * controller escreve a conversao. Ela depende do NOME do parametro na rota.
 */
const RAIZ = path.resolve(process.cwd(), 'src/modules');

function arquivosDeRota(): string[] {
  return fs
    .readdirSync(RAIZ, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(RAIZ, e.name, 'routes.ts'))
    .filter((p) => fs.existsSync(p));
}

/** Uma chamada `router.<verbo>(...)`, do inicio dela ate a proxima. */
interface Rota {
  arquivo: string;
  caminho: string;
  texto: string;
}

function rotasDe(arquivo: string): Rota[] {
  const conteudo = fs.readFileSync(arquivo, 'utf8');
  const inicios = [...conteudo.matchAll(/router\.(get|post|put|patch|delete)\s*\(/g)];

  return inicios.flatMap((inicio, i) => {
    const de = inicio.index!;
    const ate = i + 1 < inicios.length ? inicios[i + 1].index! : conteudo.length;
    const texto = conteudo.slice(de, ate);
    const caminho = /^\s*router\.\w+\s*\(\s*'([^']*)'/.exec(texto)?.[1];
    return caminho === undefined
      ? []
      : [{ arquivo: path.basename(path.dirname(arquivo)), caminho, texto }];
  });
}

describe('guarda de parametro numerico nas rotas', () => {
  const rotas = arquivosDeRota().flatMap(rotasDe);

  it('a varredura enxerga o conjunto real de rotas', () => {
    // Contraprova: se o parser quebrar, tudo passa por vacuidade.
    expect(rotas.length).toBeGreaterThan(100);
    expect(rotas.some((r) => r.caminho.includes(':'))).toBe(true);
  });

  it('toda rota com parametro numerico valida esse parametro', () => {
    const semGuarda = rotas
      .filter((rota) => {
        const params = [...rota.caminho.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
        const numericos = params.filter((p) => NOME_DE_PARAMETRO_NUMERICO.test(p));
        return numericos.length > 0 && !rota.texto.includes("'params'");
      })
      .map((rota) => `${rota.arquivo}${rota.caminho}`);

    expect(semGuarda).toEqual([]);
  });
});

describe('paramsNumericos()', () => {
  it('recusa o que nao e ID e aceita o que e', () => {
    const schema = paramsNumericos('id');
    expect(schema.safeParse({ id: 'abc' }).success).toBe(false);
    expect(schema.safeParse({ id: '0' }).success).toBe(false);
    expect(schema.safeParse({ id: '-1' }).success).toBe(false);
    expect(schema.safeParse({ id: '1.5' }).success).toBe(false);
    expect(schema.safeParse({ id: '' }).success).toBe(false);
    expect(schema.safeParse({ id: '42' })).toMatchObject({ success: true, data: { id: 42 } });
  });

  /**
   * O `strip` padrao do Zod apagaria `processCode`, e o controller receberia
   * `undefined` sem nenhum erro. Trocar um 400 legivel por um bug mudo seria
   * pior do que nao ter guarda nenhuma.
   */
  it('preserva os parametros nao numericos da mesma rota', () => {
    const r = paramsNumericos('id').safeParse({ id: '7', processCode: 'PK2052602TJ' });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ id: 7, processCode: 'PK2052602TJ' });
  });

  it('valida os DOIS parametros de uma rota aninhada', () => {
    const schema = paramsNumericos('id', 'stageId');
    expect(schema.safeParse({ id: '3', stageId: 'x' }).success).toBe(false);
    expect(schema.safeParse({ id: '3', stageId: '9' })).toMatchObject({
      success: true,
      data: { id: 3, stageId: 9 },
    });
  });
});
