import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guarda ESTATICA: toda variavel LIDA pelo codigo da API precisa estar
 * declarada no servico `api` do compose de producao.
 *
 * O servico usa lista EXPLICITA de `environment:` — nao ha `env_file`. O que
 * nao esta listado nao chega ao container, e uma variavel definida no `.env` de
 * producao simplesmente nao faz nada. O defeito e MUDO: nenhum erro, nenhum
 * log, so o botao sem efeito.
 *
 * Ja mordeu tres vezes: `MAIL_DRY_RUN`/`SMTP_AUTH_MODE`, os tetos da guarda de
 * arquivo compactado, e `AI_DAILY_BUDGET_BRL` — este ultimo DEFINIDO no `.env`
 * de producao enquanto o proprio alerta de 80% instruia o operador a
 * "ajustar AI_DAILY_BUDGET_BRL". Em 2026-08-29 eram 38 variaveis nessa
 * situacao. Nenhum teste de comportamento pega isso: o defeito e a ausencia de
 * uma linha num arquivo de infraestrutura, entao a verificacao tem de comparar
 * codigo com infraestrutura.
 */
const RAIZ_API = path.resolve(process.cwd(), 'src');
const COMPOSE = path.resolve(process.cwd(), '../../docker-compose.prod.yml');

/**
 * Excecoes, com o motivo. Uma excecao sem motivo escrito e uma variavel
 * esquecida com aparencia de decisao.
 */
const NAO_PRECISAM_IR: Record<string, string> = {
  SEED_ADMIN_EMAIL: 'lida so por shared/database/seed.ts, que nao roda no container de producao',
  SEED_ADMIN_PASSWORD: 'idem — e e segredo, nao deve constar do compose',
};

function variaveisLidasNoCodigo(): Set<string> {
  const encontradas = new Set<string>();
  const visitar = (dir: string) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const alvo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== '__tests__') visitar(alvo);
        continue;
      }
      if (!entrada.name.endsWith('.ts')) continue;
      // Comentario que MENCIONA uma variavel nao a le. Sem descontar, o
      // comentario que explica por que `REVISION` foi removida faria a guarda
      // exigir `REVISION` no compose — o oposto do que ela quer.
      const conteudo = fs
        .readFileSync(alvo, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const m of conteudo.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) encontradas.add(m[1]);
      for (const m of conteudo.matchAll(/process\.env\['([A-Z][A-Z0-9_]*)'\]/g))
        encontradas.add(m[1]);
      // Leitura indireta pelos helpers: envTexto('X', ...) / envNumeroPositivo('X', ...)
      for (const m of conteudo.matchAll(/env(?:Texto|NumeroPositivo)\(\s*'([A-Z][A-Z0-9_]*)'/g))
        encontradas.add(m[1]);
    }
  };
  visitar(RAIZ_API);
  return encontradas;
}

function variaveisDeclaradasNoCompose(): Set<string> {
  const conteudo = fs.readFileSync(COMPOSE, 'utf8');
  const bloco = conteudo.split('\n  api:')[1]?.split('\n  cert-volumes-init:')[0] ?? '';
  const declaradas = new Set<string>();
  for (const m of bloco.matchAll(/^\s{6}([A-Z][A-Z0-9_]*):/gm)) declaradas.add(m[1]);
  for (const m of bloco.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) declaradas.add(m[1]);
  return declaradas;
}

describe('toda variavel lida pela API chega ao container', () => {
  const lidas = variaveisLidasNoCodigo();
  const declaradas = variaveisDeclaradasNoCompose();

  it('a varredura enxerga o codigo e o compose', () => {
    // Contraprova: se qualquer um dos dois lados vier vazio, tudo passa por
    // vacuidade e a guarda nao guarda nada.
    expect(lidas.size).toBeGreaterThan(50);
    expect(declaradas.size).toBeGreaterThan(50);
    expect(declaradas.has('DATABASE_URL')).toBe(true);
  });

  it('nenhuma leitura fica sem entrada no compose de producao', () => {
    const ausentes = [...lidas]
      .filter((nome) => !declaradas.has(nome) && !(nome in NAO_PRECISAM_IR))
      .sort();

    expect(ausentes).toEqual([]);
  });

  it('toda excecao declarada ainda existe no codigo, e traz motivo', () => {
    for (const [nome, motivo] of Object.entries(NAO_PRECISAM_IR)) {
      expect(motivo.length, `${nome} sem motivo escrito`).toBeGreaterThan(20);
      // Excecao para variavel que ninguem le mais e lixo acumulando.
      expect(lidas.has(nome), `${nome} nao e mais lida: remova a excecao`).toBe(true);
    }
  });
});
