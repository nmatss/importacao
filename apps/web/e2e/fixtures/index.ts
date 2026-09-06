import type { Page, Route } from '@playwright/test';
import type { FixtureHandler } from './types';
import { importacaoCoreHandlers } from './importacao-core';
import { importacaoOpsHandlers } from './importacao-ops';
import { processDetailHandlers } from './process-detail';
import { certApiHandlers, certValidationStreamBody } from './cert-api';

/**
 * Ordem importa: o primeiro handler que casar responde. Os sub-recursos do
 * detalhe do processo vem antes do core porque ambos podem declarar
 * `/api/email-ingestion/logs`; o do detalhe reage ao `processId`.
 */
export const allHandlers: FixtureHandler[] = [
  ...processDetailHandlers,
  ...importacaoCoreHandlers,
  ...importacaoOpsHandlers,
  ...certApiHandlers,
];

function matches(handler: FixtureHandler, pathname: string, method: string): boolean {
  if ((handler.method ?? 'GET') !== method) return false;
  return typeof handler.path === 'string' ? handler.path === pathname : handler.path.test(pathname);
}

export function resolveFixture(url: URL, method: string) {
  const handler = allHandlers.find((h) => matches(h, url.pathname, method));
  if (!handler) return null;
  const body = typeof handler.body === 'function' ? handler.body(url, method) : handler.body;
  return { status: handler.status ?? 200, body };
}

/**
 * Instala o sandbox de API no page: sessao autenticada, GSI do Google
 * substituido por stub e toda chamada a `/api` ou `/cert-api` respondida por
 * fixture. Rotas sem fixture respondem `{ success: true, data: [] }` e sao
 * registradas em `unmatched` para a auditoria apontar buracos.
 */
export async function installFixtureSandbox(
  page: Page,
  unmatched?: Set<string>,
  options: { authenticated?: boolean } = {},
) {
  if (options.authenticated !== false) {
    await page.addInitScript(() => localStorage.setItem('importacao_token', 'e2e-browser-token'));
  }
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.google={accounts:{id:{initialize(){},renderButton(element){element.textContent='Google';},prompt(){},cancel(){},revoke(){}}}};`,
    }),
  );

  await page.route(
    (url) => /^\/(?:api|cert-api)\//.test(url.pathname),
    async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      if (options.authenticated === false && url.pathname === '/api/auth/me') {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'Unauthorized' }),
        });
      }
      // SSE do progresso da validacao: fora do contrato JSON dos handlers.
      if (method === 'GET' && /^\/cert-api\/api\/validate\/[^/]+\/stream$/.test(url.pathname)) {
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: certValidationStreamBody,
        });
      }
      const resolved = resolveFixture(url, method);
      if (!resolved) {
        unmatched?.add(`${method} ${url.pathname}`);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: [] }),
        });
      }
      return route.fulfill({
        status: resolved.status,
        contentType: 'application/json',
        body: JSON.stringify(resolved.body),
      });
    },
  );
}
