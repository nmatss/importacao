import { expect, test, type Page, type Route } from '@playwright/test';

const adminUser = {
  id: '1',
  name: 'Admin E2E',
  email: 'admin@e2e.test',
  role: 'admin',
};

const routes = [
  '/login',
  '/portal',
  '/importacao',
  '/importacao/dashboard',
  '/importacao/meu-dia',
  '/importacao/executivo',
  '/importacao/processos',
  '/importacao/processos/novo',
  '/importacao/processos/1',
  '/importacao/processos/1/editar',
  '/importacao/pre-cons',
  '/importacao/compras-pagamentos',
  '/importacao/cambios',
  '/importacao/lis',
  '/importacao/desembaraco',
  '/importacao/numerario',
  '/importacao/follow-up',
  '/importacao/assistente',
  '/importacao/comunicacoes',
  '/importacao/alertas',
  '/importacao/email-ingestion',
  '/importacao/auditoria',
  '/importacao/configuracoes',
  '/importacao/rota-inexistente',
  '/certificacoes',
  '/certificacoes/validacao',
  '/certificacoes/produtos',
  '/certificacoes/produtos/SKU-E2E',
  '/certificacoes/cadastro',
  '/certificacoes/relatorios',
  '/certificacoes/relatorios/1',
  '/certificacoes/agendamentos',
  '/certificacoes/configuracoes',
  '/certificacoes/rota-inexistente',
] as const;

const redirects = [
  { from: '/', to: '/portal' },
  { from: '/dashboard', to: '/portal' },
  { from: '/processos', to: '/importacao/processos' },
  { from: '/processos/1', to: '/importacao/processos/1' },
  { from: '/rota-global-inexistente', to: '/portal' },
] as const;

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function installApiSandbox(page: Page) {
  await page.addInitScript(() => localStorage.setItem('importacao_token', 'e2e-browser-token'));
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.google={accounts:{id:{initialize(){},renderButton(element){element.textContent='Google';},prompt(){},cancel(){},revoke(){}}}};`,
    }),
  );

  await page.route(/^http:\/\/127\.0\.0\.1:4174\/(?:api|cert-api)\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.pathname === '/api/auth/me') {
      return json(route, { success: true, data: adminUser });
    }
    if (request.method() === 'GET' && url.pathname === '/api/health') {
      return json(route, { status: 'ok' });
    }
    if (request.method() === 'GET' && url.pathname === '/api/processes/1') {
      return json(route, {
        success: true,
        data: {
          id: 1,
          processCode: 'IMP-E2E-001',
          brand: 'Puket',
          status: 'documentation',
          supplier: 'Fornecedor E2E',
          currency: 'USD',
          totalValue: 100,
          createdAt: '2026-08-26T12:00:00.000Z',
          updatedAt: '2026-08-26T12:00:00.000Z',
        },
      });
    }
    if (request.method() === 'GET' && url.pathname === '/api/processes') {
      return json(route, {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 20, pages: 0 },
      });
    }
    if (request.method() === 'GET' && url.pathname === '/api/sydle/payments-report/summary') {
      return json(route, {
        success: true,
        data: {
          totalPurchaseUsd: 0,
          totalPaidUsd: 0,
          totalOpenUsd: 0,
          totalBrl: 0,
          records: 0,
          matched: 0,
          unmatched: 0,
          overdue: 0,
          dueSoon: 0,
          paid: 0,
          config: {
            enabled: false,
            configured: false,
            missing: [],
            paymentsPath: '',
            pageSize: 50,
          },
          lastRun: null,
        },
      });
    }
    if (request.method() === 'GET' && url.pathname === '/api/sydle/payments-report') {
      return json(route, {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 50, pages: 0 },
      });
    }
    if (request.method() === 'GET' && url.pathname === '/api/sydle/sync-runs') {
      return json(route, { success: true, data: [] });
    }

    if (request.method() === 'GET' && url.pathname === '/cert-api/api/certificates') {
      return json(route, { items: [], total: 0, page: 1, per_page: 10, total_pages: 0 });
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/certificates/linx-lookup') {
      return json(route, {
        status: 'found',
        sku: 'SKU-E2E',
        brand: 'puket',
        produto_codigo: 'PROD-E2E',
        validade_certificado: null,
        vencimento_licenciamento: null,
        properties: {
          validade_certificado: {
            property_code: 'VALIDADE_CERTIFICADO',
            raw_value: null,
            state: 'empty',
          },
          vencimento_licenciamento: {
            property_code: 'VENCIMENTO_LICENCIAMENTO',
            raw_value: null,
            state: 'empty',
          },
        },
      });
    }
    if (
      request.method() === 'GET' &&
      (url.pathname === '/cert-api/api/products' || url.pathname === '/cert-api/api/expired')
    ) {
      return json(route, { products: [], total: 0, page: 1, per_page: 20, total_pages: 0 });
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/products/SKU-E2E') {
      return json(route, { sku: 'SKU-E2E', brand: 'puket', name: 'Produto E2E' });
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/stats') {
      return json(route, { total: 0, by_brand: [], last_run: null });
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/reports') {
      return json(route, []);
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/data')) {
      return json(route, {
        results: [],
        summary: { total: 0, ok: 0, missing: 0, inconsistent: 0, not_found: 0 },
      });
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/schedules') {
      return json(route, []);
    }
    if (request.method() === 'GET' && url.pathname === '/cert-api/api/health') {
      return json(route, { status: 'ok' });
    }

    return json(route, { success: true, data: [] });
  });
}

async function expectHealthyPage(page: Page) {
  await expect(page.locator('main#main')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() => page.locator('[aria-label="Carregando"]').count(), { timeout: 10_000 })
    .toBe(0);

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  (page as Page & { __browserErrors?: string[] }).__browserErrors = errors;
  await installApiSandbox(page);
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { __browserErrors?: string[] }).__browserErrors).toEqual([]);
});

for (const path of routes) {
  test(`renders ${path} without browser errors or horizontal overflow`, async ({ page }) => {
    await page.goto(path);
    await expectHealthyPage(page);
  });
}

for (const { from, to } of redirects) {
  test(`redirects ${from} to ${to}`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replaceAll('/', '\\/')}/?$`));
    await expectHealthyPage(page);
  });
}
