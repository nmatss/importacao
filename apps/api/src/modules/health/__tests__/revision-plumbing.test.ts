import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(process.cwd(), '..', '..');
const ROUTES = path.resolve(process.cwd(), 'src/modules/health/routes.ts');
const COMPOSE = path.resolve(REPO_ROOT, 'docker-compose.prod.yml');
const DEPLOY = path.resolve(REPO_ROOT, 'scripts/deploy.sh');

/**
 * Guarda estatica para um defeito que mora numa AUSENCIA, e por isso nenhum
 * teste de runtime pegava: `/health/live` lia `process.env.REVISION`, variavel
 * que nada no repositorio define. O deploy injeta o SHA como `APP_VERSION`
 * (`APP_VERSION='<sha>' docker compose up`, repassado no compose de producao) e
 * ainda grava um ARQUIVO `REVISION` no servidor que nenhum processo le.
 *
 * Consequencia medida: o endpoint respondeu `revision: null` em toda a sua
 * historia, e confirmar qual SHA estava rodando exigia inspecionar o servidor na
 * mao — exatamente o que aconteceu na revisao pos-deploy de 2026-08-29.
 *
 * O caso decisivo e o ultimo: ele nao confere um nome fixo, confere que o nome
 * LIDO pelo endpoint e um nome que o compose de producao ENTREGA. Renomear a
 * variavel de um lado so volta a falhar aqui.
 */
describe('plumbing da revisao exposta em /health/live', () => {
  const routes = fs.readFileSync(ROUTES, 'utf-8');
  const compose = fs.readFileSync(COMPOSE, 'utf-8');

  /** Nomes de env que o endpoint usa para responder `revision`. */
  function envNamesForRevision(source: string): string[] {
    const line = source.split('\n').find((l) => /^\s*revision:/.test(l));
    if (!line) return [];
    return [...line.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  }

  /** Nomes de env que o compose de producao define para o servico `api`. */
  function composeApiEnvNames(source: string): Set<string> {
    return new Set([...source.matchAll(/^\s{6}([A-Z0-9_]+):\s/gm)].map((m) => m[1]));
  }

  it('o deploy continua injetando o SHA como APP_VERSION', () => {
    const deploy = fs.readFileSync(DEPLOY, 'utf-8');
    expect(deploy).toMatch(/APP_VERSION='\$\{LOCAL_SHA\}'/);
  });

  it('o compose de producao repassa APP_VERSION para o container', () => {
    expect(compose).toMatch(/APP_VERSION:\s*\$\{APP_VERSION/);
  });

  it('o endpoint le pelo menos um nome que o compose realmente entrega', () => {
    const lidos = envNamesForRevision(routes);
    expect(lidos.length).toBeGreaterThan(0);

    const entregues = composeApiEnvNames(compose);
    const casam = lidos.filter((nome) => entregues.has(nome));

    expect(
      casam,
      `/health/live le ${JSON.stringify(lidos)}, mas docker-compose.prod.yml ` +
        `nao define nenhum deles — o campo responderia null em producao.`,
    ).not.toHaveLength(0);
  });
});
