import { expect, test, type Page, type Route } from '@playwright/test';

interface CapturedRequest {
  method: string;
  path: string;
  body?: unknown;
}

const adminUser = {
  id: '1',
  name: 'Admin E2E',
  email: 'admin@e2e.test',
  role: 'admin',
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

async function installApiSandbox(page: Page, captured: CapturedRequest[]) {
  await page.addInitScript(() => localStorage.setItem('importacao_token', 'e2e-browser-token'));

  await page.route(/^http:\/\/127\.0\.0\.1:4174\/(?:api|cert-api)\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;
    const method = request.method();
    const body = request.postDataJSON?.();
    captured.push({ method, path, ...(body === null ? {} : { body }) });

    if (method === 'GET' && url.pathname === '/api/auth/me') {
      return json(route, { success: true, data: adminUser });
    }
    if (method === 'GET' && url.pathname === '/api/processes') {
      return json(route, {
        success: true,
        data: [
          {
            id: 1,
            processCode: 'IMP-001',
            brand: 'Puket',
            status: 'documentation',
            supplier: 'Fornecedor E2E',
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, pages: 1 },
      });
    }
    if (method === 'GET' && url.pathname === '/api/communications') {
      return json(route, {
        success: true,
        data: [],
        pagination: { total: 0, page: 1, limit: 100, pages: 0 },
      });
    }
    if (method === 'GET' && url.pathname === '/api/settings/email-signatures') {
      return json(route, { success: true, data: [] });
    }
    if (method === 'GET' && url.pathname === '/api/settings/communication-templates') {
      return json(route, { success: true, data: [] });
    }
    if (method === 'GET' && url.pathname === '/api/documents/process/1') {
      return json(route, { success: true, data: [] });
    }
    if (method === 'POST' && url.pathname === '/api/communications') {
      return json(
        route,
        {
          success: true,
          data: { id: 77, status: 'draft', ...(body as Record<string, unknown>) },
        },
        201,
      );
    }
    if (method === 'POST' && url.pathname === '/api/communications/77/send') {
      return json(route, {
        success: true,
        data: { id: 77, status: 'sent', sentAt: new Date().toISOString() },
      });
    }
    if (method === 'GET' && url.pathname === '/api/settings/smtp') {
      return json(route, {
        success: true,
        data: [
          { key: 'smtp_host', value: 'smtp.example.test' },
          { key: 'smtp_port', value: '587' },
          { key: 'smtp_user', value: 'relay@example.test' },
          { key: 'smtp_from', value: '"Uni.co" <sender@example.test>' },
        ],
      });
    }
    if (method === 'GET' && url.pathname === '/api/settings/recipients') {
      return json(route, {
        success: true,
        data: [
          { key: 'kiom_email', value: 'kiom@example.test' },
          { key: 'fenicia_email', value: 'fenicia@example.test' },
          { key: 'isa_email', value: '' },
          { key: 'default_cc_email', value: 'global@example.test' },
        ],
      });
    }
    if (method === 'GET' && url.pathname === '/api/settings/google_chat_webhook_url') {
      return json(route, { success: true, data: { key: 'google_chat_webhook_url', value: '' } });
    }
    if (method === 'PUT' && url.pathname === '/api/settings/smtp') {
      return json(route, { success: true, data: body });
    }
    if (method === 'POST' && url.pathname === '/api/settings/smtp/test') {
      return json(route, { success: true, data: { verified: true } });
    }
    if (method === 'GET') return json(route, { success: true, data: [] });
    return json(route, { success: true, data: body ?? {} });
  });
}

async function expectNoHorizontalPageOverflow(page: Page) {
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
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { __browserErrors?: string[] }).__browserErrors).toEqual([]);
});

test('composes, confirms and submits an e-mail with accessible focus behavior', async ({
  page,
}) => {
  const captured: CapturedRequest[] = [];
  await installApiSandbox(page, captured);
  await page.goto('/importacao/comunicacoes');

  await expect(page.getByRole('heading', { name: 'Atendimentos e E-mails' })).toBeVisible();
  const processInput = page.getByRole('combobox', { name: 'Processo', exact: true });
  await processInput.fill('IM');
  await expect
    .poll(() => captured.some((entry) => entry.path.startsWith('/api/processes?')))
    .toBe(true);
  await processInput.fill('IMP-001 - Puket');
  await expect(page.getByText('Nenhum documento disponível para anexar.')).toBeVisible();

  await page.getByLabel('Destinatário', { exact: true }).fill('Parceiro E2E');
  await page.getByLabel('E-mail', { exact: true }).fill('partner@example.test');
  await page.getByLabel('Assunto').fill('Validação E2E de envio');
  await page.getByLabel('Mensagem').fill('Conteúdo verificado pelo navegador.');

  const sendButton = page.getByRole('button', { name: 'Enviar e-mail' });
  await sendButton.click();
  const dialog = page.getByRole('dialog', { name: 'Enviar e-mail?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(sendButton).toBeFocused();

  await sendButton.click();
  await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('E-mail enviado com sucesso')).toBeVisible();

  const create = captured.find(
    (entry) => entry.method === 'POST' && entry.path === '/api/communications',
  );
  const send = captured.find(
    (entry) => entry.method === 'POST' && entry.path === '/api/communications/77/send',
  );
  expect(create?.body).toMatchObject({
    processId: 1,
    recipient: 'Parceiro E2E',
    recipientEmail: 'partner@example.test',
    subject: 'Validação E2E de envio',
    body: 'Conteúdo verificado pelo navegador.',
  });
  expect(send?.body).toEqual({ signatureId: null });
  await expectNoHorizontalPageOverflow(page);
});

test('loads, saves and verifies SMTP without sending a message', async ({ page }) => {
  const captured: CapturedRequest[] = [];
  await installApiSandbox(page, captured);
  await page.goto('/importacao/configuracoes');

  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await expect(page.getByLabel('Host')).toHaveValue('smtp.example.test');
  await page.getByLabel('Host').fill('relay.example.test');
  await page.getByLabel('Porta').fill('2525');

  const smtpCard = page
    .getByText('Configurações SMTP', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await smtpCard.getByRole('button', { name: 'Salvar' }).click();
  await expect(smtpCard.getByText('Salvo com sucesso')).toBeVisible();
  await smtpCard.getByRole('button', { name: 'Testar conexão' }).click();
  await expect(
    page.getByText('Conexão SMTP autenticada com sucesso. Nenhum e-mail foi enviado.'),
  ).toBeVisible();

  const save = captured.find(
    (entry) => entry.method === 'PUT' && entry.path === '/api/settings/smtp',
  );
  expect(save?.body).toMatchObject({ smtp_host: 'relay.example.test', smtp_port: '2525' });
  expect(
    captured.some((entry) => entry.method === 'POST' && entry.path === '/api/settings/smtp/test'),
  ).toBe(true);
  await expectNoHorizontalPageOverflow(page);
});
