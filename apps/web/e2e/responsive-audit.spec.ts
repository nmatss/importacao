import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installFixtureSandbox } from './fixtures';

/**
 * Auditoria responsiva: renderiza cada tela com fixtures RICAS (o smoke usa
 * listas vazias, que escondem quase todo problema de layout) em varias
 * larguras e nos dois temas, mede overflow horizontal e elementos fora da
 * viewport, e grava screenshots de pagina inteira em
 * `output/playwright/responsive-audit/` (ou AUDIT_OUT).
 *
 * Modos:
 * - opt-in: use AUDIT_ASSERT ou AUDIT_VIEWPORTS; registra metricas e capturas,
 *   falha em erro de browser, preparo, carregamento ou fixture ausente.
 * - `AUDIT_ASSERT=1`: falha tambem quando ha overflow horizontal no <main>
 *   ou elemento fora da viewport (gate de regressao).
 *
 * Filtros: `AUDIT_VIEWPORTS=360,768`, `AUDIT_THEMES=dark`, `AUDIT_ONLY=regex`.
 */

interface Scenario {
  id: string;
  path: string;
  /** Interacao apos o carregamento (abrir menu, aba, modal...). */
  prepare?: (page: Page) => Promise<void>;
  /** Larguras minimas/maximas em que o cenario faz sentido (ex.: menu mobile). */
  minWidth?: number;
  maxWidth?: number;
  /** Sem sessao: `/login` redireciona usuario autenticado para o portal. */
  guest?: boolean;
  /** Overlays (menu, modal, drawer) sao `fixed`: captura so a viewport. */
  viewportOnly?: boolean;
}

interface Offender {
  tag: string;
  cls: string;
  text: string;
  left: number;
  right: number;
  width: number;
  depth: number;
}

interface Metrics {
  vw: number;
  docScrollWidth: number;
  mainOverflow: number;
  offenders: Offender[];
  horizontalScrollers: { tag: string; cls: string; overflow: number }[];
  smallTargets: number;
}

interface Entry {
  scenario: string;
  path: string;
  theme: string;
  width: number;
  height: number;
  screenshot: string;
  content?: string;
  metrics: Metrics;
  unmatched: string[];
  errors: string[];
}

const ALL_VIEWPORTS: { width: number; height: number }[] = [
  { width: 320, height: 568 },
  { width: 360, height: 740 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 639, height: 900 },
  { width: 640, height: 360 },
  { width: 767, height: 900 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 844, height: 390 },
  { width: 1023, height: 768 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1535, height: 900 },
  { width: 1536, height: 900 },
  { width: 1920, height: 1080 },
];

const DEFAULT_ASSERT_VIEWPORTS = [320, 375, 768, 1024, 1440];

function clickText(text: string | RegExp, role: 'button' | 'link' | 'tab' = 'button') {
  return async (page: Page) => {
    const target = page.getByRole(role, { name: text }).first();
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await page.waitForTimeout(400);
  };
}

const processTabs = [
  'draft_bl',
  'pre_cons',
  'proformas',
  'documentos',
  'comparativo',
  'checklist',
  'followup',
  'registro',
  'etapas',
  'erros_custos',
  'comunicacoes',
  'emails',
  'historico',
  'cambios',
  'espelho',
];

const scenarios: Scenario[] = [
  { id: 'login', path: '/login', guest: true },
  { id: 'login-expired', path: '/login?expired=1', guest: true },
  { id: 'portal', path: '/portal' },
  { id: 'imp-dashboard', path: '/importacao/dashboard' },
  {
    id: 'imp-dashboard-menu',
    viewportOnly: true,
    path: '/importacao/dashboard',
    maxWidth: 1023,
    prepare: clickText('Abrir menu'),
  },
  {
    id: 'imp-dashboard-assistente',
    viewportOnly: true,
    path: '/importacao/dashboard',
    prepare: clickText('Abrir assistente IA'),
  },
  {
    id: 'imp-dashboard-tema',
    viewportOnly: true,
    path: '/importacao/dashboard',
    prepare: clickText('Alterar tema'),
  },
  { id: 'imp-meu-dia', path: '/importacao/meu-dia' },
  { id: 'imp-executivo', path: '/importacao/executivo' },
  { id: 'imp-processos', path: '/importacao/processos' },
  { id: 'imp-processo-novo', path: '/importacao/processos/novo' },
  ...processTabs.map((tab) => ({
    id: `imp-processo-${tab}`,
    path: `/importacao/processos/1?tab=${tab}`,
    prepare:
      tab === 'draft_bl'
        ? async (page: Page) => {
            const finalColumn = page.getByRole('columnheader', { name: 'BL Final', exact: true });
            const wrapper = finalColumn.locator('xpath=ancestor::table/..');
            const state = await wrapper.evaluate((element) => ({
              overflow: element.scrollWidth > element.clientWidth + 1,
              mode: getComputedStyle(element).overflowX,
            }));
            if (state.overflow) {
              expect(['auto', 'scroll']).toContain(state.mode);
              await wrapper.evaluate((element) => {
                element.scrollLeft = element.scrollWidth;
              });
            }
            await finalColumn.scrollIntoViewIfNeeded();
            await expect(finalColumn).toBeInViewport();
            await wrapper.evaluate((element) => {
              element.scrollLeft = 0;
            });
            await page.locator('main#main').evaluate((element) => {
              element.scrollTop = 0;
            });
          }
        : undefined,
  })),
  { id: 'imp-processo-editar', path: '/importacao/processos/1/editar' },
  { id: 'imp-pre-cons', path: '/importacao/pre-cons' },
  { id: 'imp-sydle', path: '/importacao/compras-pagamentos' },
  {
    id: 'imp-sydle-drawer',
    viewportOnly: true,
    path: '/importacao/compras-pagamentos',
    prepare: async (page) => {
      const row = page.locator('tbody tr:visible, main#main div.cursor-pointer:visible').first();
      await row.scrollIntoViewIfNeeded();
      await row.click();
      await expect(
        page.getByRole('dialog', { name: 'Detalhe da compra / pagamento' }),
      ).toBeVisible();
    },
  },
  {
    id: 'imp-cambios',
    path: '/importacao/cambios',
    prepare: async (page) => {
      await page.getByLabel('Processo', { exact: true }).selectOption('1');
      await page.getByRole('button', { name: 'Novo Cambio', exact: true }).click();
      await expect(page.getByLabel('Tipo', { exact: true })).toBeVisible();
    },
  },
  { id: 'imp-lis', path: '/importacao/lis' },
  { id: 'imp-desembaraco', path: '/importacao/desembaraco' },
  { id: 'imp-numerario', path: '/importacao/numerario' },
  { id: 'imp-follow-up', path: '/importacao/follow-up' },
  { id: 'imp-assistente', path: '/importacao/assistente' },
  { id: 'imp-comunicacoes', path: '/importacao/comunicacoes' },
  { id: 'imp-alertas', path: '/importacao/alertas' },
  { id: 'imp-email-ingestion', path: '/importacao/email-ingestion' },
  { id: 'imp-auditoria', path: '/importacao/auditoria' },
  { id: 'imp-config-email', path: '/importacao/configuracoes' },
  {
    id: 'imp-config-users',
    path: '/importacao/configuracoes',
    prepare: clickText(/^Usuários$/),
  },
  {
    id: 'imp-config-users-modal',
    viewportOnly: true,
    path: '/importacao/configuracoes',
    prepare: async (page) => {
      await clickText(/^Usuários$/)(page);
      await clickText(/Novo Usuário/)(page);
    },
  },
  {
    id: 'imp-config-integrations',
    path: '/importacao/configuracoes',
    prepare: clickText(/^Integrações$/),
  },
  {
    id: 'imp-config-templates',
    path: '/importacao/configuracoes',
    prepare: clickText(/^Modelos$/),
  },
  {
    id: 'imp-config-signatures',
    path: '/importacao/configuracoes',
    prepare: clickText(/^Assinaturas$/),
  },
  { id: 'imp-rota-inexistente', path: '/importacao/rota-inexistente' },
  { id: 'cert-dashboard', path: '/certificacoes' },
  {
    id: 'cert-dashboard-menu',
    viewportOnly: true,
    path: '/certificacoes',
    maxWidth: 1023,
    prepare: clickText('Abrir menu'),
  },
  { id: 'cert-validacao', path: '/certificacoes/validacao' },
  {
    id: 'cert-produtos',
    path: '/certificacoes/produtos',
    prepare: async (page: Page) => {
      const input = page.getByRole('textbox', { name: 'Buscar produto por SKU ou nome' });
      await input.scrollIntoViewIfNeeded();
      const box = await input.boundingBox();
      const submit = await page.getByRole('button', { name: 'Buscar', exact: true }).boundingBox();
      expect(box?.width, 'Busca deve manter largura utilizavel').toBeGreaterThanOrEqual(120);
      expect(box && submit && box.x + box.width <= submit.x).toBe(true);
      await page.locator('main#main').evaluate((main) => {
        main.scrollTop = 0;
      });
    },
  },
  { id: 'cert-produto-detalhe', path: '/certificacoes/produtos/SKU-E2E-0001' },
  { id: 'cert-cadastro', path: '/certificacoes/cadastro' },
  { id: 'cert-relatorios', path: '/certificacoes/relatorios' },
  { id: 'cert-relatorio-detalhe', path: '/certificacoes/relatorios/relatorio-e2e-0001.json' },
  { id: 'cert-agendamentos', path: '/certificacoes/agendamentos' },
  {
    id: 'cert-agendamentos-form',
    viewportOnly: true,
    path: '/certificacoes/agendamentos',
    prepare: async (page: Page) => {
      const trigger = page.getByRole('button', { name: /Novo Agendamento/ });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Novo Agendamento' });
      await expect(dialog.getByRole('button', { name: 'Fechar modal' })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      const submit = dialog.getByRole('button', { name: 'Criar Agendamento' });
      await expect(submit).toBeFocused();
      await expect(submit).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeInViewport({ ratio: 1 });
    },
  },
  { id: 'cert-configuracoes', path: '/certificacoes/configuracoes' },
  { id: 'cert-rota-inexistente', path: '/certificacoes/rota-inexistente' },
];

const outDir = path.resolve(
  process.cwd(),
  process.env.AUDIT_OUT ?? 'output/playwright/responsive-audit',
);
const shotsDir = path.join(outDir, 'shots');

function selectedViewports() {
  const env = process.env.AUDIT_VIEWPORTS;
  const wanted = env ? env.split(',').map((v) => Number(v.trim())) : DEFAULT_ASSERT_VIEWPORTS;
  return ALL_VIEWPORTS.filter((v) => wanted.includes(v.width));
}

function selectedThemes(): ('light' | 'dark')[] {
  const env = process.env.AUDIT_THEMES;
  if (!env) return ['light', 'dark'];
  return env.split(',').map((t) => t.trim()) as ('light' | 'dark')[];
}

function selectedScenarios() {
  const only = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;
  return only ? scenarios.filter((s) => only.test(s.id)) : scenarios;
}

async function waitForSettled(page: Page) {
  await page.waitForLoadState('networkidle');
  // O fallback de Suspense nao possui aria-label. Esperar seu texto visivel
  // evita aprovar apenas o shell enquanto o modulo ainda esta carregando.
  await expect(page.getByText(/^Carregando(?:[ .…]|$)/).filter({ visible: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.locator('[aria-label="Carregando"]:visible, .skeleton:visible')).toHaveCount(
    0,
    { timeout: 20_000 },
  );
  // Animacoes de entrada terminam em <= 400ms; as dos graficos Recharts
  // (JS, nao CSS) levam ate 1500ms e nao sao cobertas por `animations: 'disabled'`.
  await page.waitForTimeout((await page.locator('.recharts-wrapper').count()) ? 1600 : 400);
}

async function collectMetrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const main = document.querySelector<HTMLElement>('main#main');
    const isScrollX = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
    // Ancestral que rola (tabela larga) ou que recorta (`overflow: hidden`,
    // fundo decorativo) explica o elemento fora da viewport sem causar scroll.
    const insideIntentionalScroll = (el: Element) => {
      let p = el.parentElement;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (p !== main && /(auto|scroll)/.test(ox) && p.scrollWidth > p.clientWidth + 1)
          return true;
        if (p !== main && !p.contains(main) && /(hidden|clip)/.test(ox)) return true;
        p = p.parentElement;
      }
      return false;
    };
    const describe = (el: Element) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 8).join(' '),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    });

    const offenders: Offender[] = [];
    const horizontalScrollers: { tag: string; cls: string; overflow: number }[] = [];
    let smallTargets = 0;
    const seen = new Set<Element>();

    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('aside[aria-hidden="true"]')) continue;
      if (el.closest('[data-modal-portal]') && el.getAttribute('role') !== 'dialog') {
        // conteudo de modal e medido pelo proprio dialog
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      if (el !== main && isScrollX(el) && el.scrollWidth > el.clientWidth + 1) {
        horizontalScrollers.push({ ...describe(el), overflow: el.scrollWidth - el.clientWidth });
      }

      if ((r.right > vw + 1 || r.left < -1) && !insideIntentionalScroll(el)) {
        // Ignora filhos de um ofensor ja registrado: o pai explica o problema.
        let ancestorSeen = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (seen.has(p)) {
            ancestorSeen = true;
            break;
          }
        }
        if (!ancestorSeen) {
          let depth = 0;
          for (let p = el.parentElement; p; p = p.parentElement) depth += 1;
          offenders.push({
            ...describe(el),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            depth,
          });
          seen.add(el);
        }
      }

      if (
        vw < 768 &&
        (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') &&
        r.height < 32 &&
        r.width < 32
      ) {
        smallTargets += 1;
      }
    }

    return {
      vw,
      docScrollWidth: document.documentElement.scrollWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      offenders: offenders.slice(0, 15),
      horizontalScrollers: horizontalScrollers.slice(0, 10),
      smallTargets,
    };
  });
}

const EXPAND_CSS = `
  .h-screen { height: auto !important; min-height: 100vh !important; }
  main#main { overflow: visible !important; }
  [data-audit-expand-root] { overflow: visible !important; }
`;

async function screenshotFullPage(page: Page, file: string, viewportOnly = false) {
  if (viewportOnly) {
    await page.screenshot({ path: file, animations: 'disabled' });
    return;
  }
  await page.screenshot({ path: file.replace(/\.png$/, '__viewport.png'), animations: 'disabled' });
  // <main> rola dentro de um shell h-screen; para a pagina inteira aparecer na
  // captura, o shell e expandido so durante o screenshot.
  const handle = await page.addStyleTag({ content: EXPAND_CSS });
  // Expandir o shell pode redimensionar Recharts e reiniciar a animacao JS.
  await page.waitForTimeout((await page.locator('.recharts-wrapper').count()) ? 1700 : 100);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await handle.evaluate((el) => (el as HTMLElement).remove());
}

async function runScenario(
  browser: Browser,
  scenario: Scenario,
  theme: 'light' | 'dark',
  viewport: { width: number; height: number },
): Promise<Entry> {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width < 768,
    hasTouch: viewport.width < 1024,
    deviceScaleFactor: 1,
    colorScheme: theme,
    baseURL: 'http://127.0.0.1:4174',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  const errors: string[] = [];
  const unmatched = new Set<string>();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await installFixtureSandbox(page, unmatched, { authenticated: !scenario.guest });

  const file = path.join(shotsDir, `${scenario.id}__${theme}__${viewport.width}.png`);
  try {
    await page.goto(scenario.path);
    await waitForSettled(page);
    if (scenario.prepare) {
      try {
        await scenario.prepare(page);
        await waitForSettled(page);
      } catch (error) {
        errors.push(`prepare: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await expect(page.locator('body')).not.toHaveText('');
    for (const overlay of await page.getByRole('dialog').all()) {
      await expect(overlay).toBeInViewport({ ratio: 1 });
    }
    if (!scenario.guest && scenario.path !== '/portal') {
      await expect(page.locator('main#main')).toBeVisible();
    }
    let metrics: Metrics;
    try {
      metrics = await collectMetrics(page);
      await screenshotFullPage(page, file, scenario.viewportOnly);
    } catch (error) {
      errors.push(`runner: ${error instanceof Error ? error.message : String(error)}`);
      metrics = {
        vw: viewport.width,
        docScrollWidth: 0,
        mainOverflow: 0,
        offenders: [],
        horizontalScrollers: [],
        smallTargets: 0,
      };
    }
    return {
      scenario: scenario.id,
      path: scenario.path,
      theme,
      width: viewport.width,
      height: viewport.height,
      screenshot: path.relative(outDir, file),
      metrics,
      content: ((await page.locator('main#main').count())
        ? await page.locator('main#main').innerText()
        : await page.locator('body').innerText()
      ).slice(0, 2000),
      unmatched: Array.from(unmatched),
      errors,
    };
  } catch (error) {
    errors.push(`scenario: ${error instanceof Error ? error.message : String(error)}`);
    return {
      scenario: scenario.id,
      path: scenario.path,
      theme,
      width: viewport.width,
      height: viewport.height,
      screenshot: path.relative(outDir, file),
      unmatched: [...unmatched],
      errors,
      metrics: {
        vw: viewport.width,
        docScrollWidth: 0,
        mainOverflow: 0,
        offenders: [],
        horizontalScrollers: [],
        smallTargets: 0,
      },
    };
  } finally {
    await context.close();
  }
}

for (const scenario of selectedScenarios()) {
  test(`auditoria responsiva: ${scenario.id}`, async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(
      !process.env.AUDIT_ASSERT && !process.env.AUDIT_VIEWPORTS,
      'Auditoria extensa: ativar com AUDIT_ASSERT=1 ou AUDIT_VIEWPORTS',
    );
    test.skip(testInfo.project.name !== 'chromium-desktop', 'roda uma vez, com contexts proprios');
    mkdirSync(shotsDir, { recursive: true });

    const entries: Entry[] = [];
    const themes = selectedThemes();
    const viewports = selectedViewports();
    const list = [scenario];

    for (const scenario of list) {
      for (const theme of themes) {
        for (const viewport of viewports) {
          if (scenario.minWidth && viewport.width < scenario.minWidth) continue;
          if (scenario.maxWidth && viewport.width > scenario.maxWidth) continue;
          const entry = await runScenario(browser, scenario, theme, viewport);
          entries.push(entry);
          writeFileSync(path.join(outDir, `${scenario.id}.json`), JSON.stringify(entries, null, 2));
          const flag =
            entry.metrics.mainOverflow > 1 ||
            entry.metrics.docScrollWidth > entry.metrics.vw + 1 ||
            entry.metrics.offenders.length > 0
              ? 'OVERFLOW'
              : 'ok';
          console.log(
            `${flag.padEnd(8)} ${scenario.id.padEnd(30)} ${theme.padEnd(5)} ${String(viewport.width).padStart(4)} main+${entry.metrics.mainOverflow} doc+${Math.max(0, entry.metrics.docScrollWidth - entry.metrics.vw)} off=${entry.metrics.offenders.length}${entry.errors.length ? ` errors=${entry.errors.length}` : ''}`,
          );
        }
      }
    }

    writeFileSync(path.join(outDir, `${scenario.id}.json`), JSON.stringify(entries, null, 2));

    const problems = entries.filter(
      (e) =>
        e.metrics.mainOverflow > 1 ||
        e.metrics.docScrollWidth > e.metrics.vw + 1 ||
        e.metrics.offenders.length > 0,
    );
    const unmatched = new Set(entries.flatMap((e) => e.unmatched));
    const errors = entries.filter((e) => e.errors.length > 0);

    const lines = [
      `# Auditoria responsiva — ${new Date().toISOString()}`,
      '',
      `Cenarios: ${list.length} · Temas: ${themes.join(', ')} · Larguras: ${viewports.map((v) => v.width).join(', ')}`,
      `Capturas: ${entries.length} · Com overflow: ${problems.length} · Com erro de browser: ${errors.length}`,
      '',
      '## Overflow / fora da viewport',
      '',
      ...problems.map(
        (e) =>
          `- **${e.scenario}** ${e.theme} ${e.width}px — main+${e.metrics.mainOverflow} doc+${Math.max(0, e.metrics.docScrollWidth - e.metrics.vw)}` +
          e.metrics.offenders
            .slice(0, 4)
            .map((o) => `\n  - <${o.tag} class="${o.cls}"> [${o.left}..${o.right}] "${o.text}"`)
            .join(''),
      ),
      '',
      '## Rotas sem fixture (responderam lista vazia)',
      '',
      ...Array.from(unmatched)
        .sort()
        .map((u) => `- ${u}`),
      '',
      '## Erros de browser',
      '',
      ...errors.map(
        (e) => `- ${e.scenario} ${e.theme} ${e.width}: ${e.errors.slice(0, 3).join(' | ')}`,
      ),
    ];
    writeFileSync(path.join(outDir, `${scenario.id}.md`), lines.join('\n'));

    expect(errors.map((e) => `${e.scenario} ${e.theme} ${e.width}:${e.errors.join('|')}`)).toEqual(
      [],
    );
    expect([...unmatched], 'Todas as chamadas devem ter fixture explícita').toEqual([]);
    if (process.env.AUDIT_ASSERT) {
      expect(
        problems.map((e) => `${e.scenario} ${e.theme} ${e.width}: main+${e.metrics.mainOverflow}`),
      ).toEqual([]);
    }
  });
}
