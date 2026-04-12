import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'http://192.168.168.124:8085';
const TOKEN = process.env.JWT_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJhZG1pbkBpbXBvcnRhY2FvLmNvbSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NjAwNDkwOSwiZXhwIjoxNzc2MDkxMzA5fQ.VtmvMZ86dBF5uJjGgIIAZ1SZzURPPUpNC60MFYdF1RY';
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

const PAGES = [
  { name: '01_login', path: '/login', needsAuth: false, waitFor: 2000 },
  { name: '02_portal', path: '/portal', waitFor: 3000 },
  { name: '03_dashboard', path: '/importacao/dashboard', waitFor: 4000 },
  { name: '04_executivo', path: '/importacao/executivo', waitFor: 4000 },
  { name: '05_processos_lista', path: '/importacao/processos', waitFor: 3000 },
  { name: '06_processo_detalhe', path: '/processos/263', waitFor: 3000 },
  { name: '07_processo_novo', path: '/importacao/processos/novo', waitFor: 2000 },
  { name: '08_pre_conferencia', path: '/importacao/pre-cons', waitFor: 3000 },
  { name: '09_cambios', path: '/importacao/cambios', waitFor: 3000 },
  { name: '10_lis_lpcos', path: '/importacao/lis', waitFor: 3000 },
  { name: '11_desembaraco', path: '/importacao/desembaraco', waitFor: 3000 },
  { name: '12_numerario', path: '/importacao/numerario', waitFor: 3000 },
  { name: '13_follow_up', path: '/importacao/follow-up', waitFor: 3000 },
  { name: '14_comunicacoes', path: '/importacao/comunicacoes', waitFor: 3000 },
  { name: '15_alertas', path: '/importacao/alertas', waitFor: 3000 },
  { name: '16_email_ingestion', path: '/importacao/email-ingestion', waitFor: 3000 },
  { name: '17_auditoria', path: '/importacao/auditoria', waitFor: 3000 },
  { name: '18_configuracoes', path: '/importacao/configuracoes', waitFor: 3000 },
  { name: '19_meu_dia', path: '/importacao/meu-dia', waitFor: 3000 },
  { name: '20_cert_dashboard', path: '/certificacoes/', waitFor: 3000 },
  { name: '21_cert_validacao', path: '/certificacoes/validacao', waitFor: 3000 },
  { name: '22_cert_produtos', path: '/certificacoes/produtos', waitFor: 3000 },
  { name: '23_cert_relatorios', path: '/certificacoes/relatorios', waitFor: 3000 },
  { name: '24_cert_agendamentos', path: '/certificacoes/agendamentos', waitFor: 3000 },
  { name: '25_cert_configuracoes', path: '/certificacoes/configuracoes', waitFor: 3000 },
];

const PROCESS_TABS = [
  { name: '06a_processo_draft_bl', tab: 'Draft BL' },
  { name: '06b_processo_documentos', tab: 'Documentos' },
  { name: '06c_processo_validacao', tab: 'Validação' },
  { name: '06d_processo_follow_up', tab: 'Follow-Up' },
  { name: '06e_processo_comunicacoes', tab: 'Comunicações' },
  { name: '06f_processo_historico', tab: 'Histórico' },
];

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // Take login page screenshot first (before auth)
  console.log('Capturing: 01_login');
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  } catch(e) { /* timeout ok */ }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_login.png'), fullPage: true });
  console.log('  ✓ 01_login');

  // Inject auth token
  console.log('Injecting auth token...');
  await page.evaluate((token) => {
    localStorage.setItem('importacao_token', token);
  }, TOKEN);

  // Navigate to portal to trigger auth
  await page.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Capture all authenticated pages
  for (const pg of PAGES) {
    if (pg.name === '01_login') continue;

    console.log(`Capturing: ${pg.name} (${pg.path})`);
    try {
      await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(pg.waitFor || 3000);

      // Dismiss toasts/modals
      await page.evaluate(() => {
        document.querySelectorAll('[role="dialog"] button[aria-label="Close"]').forEach(b => b.click());
        document.querySelectorAll('.Toastify__close-button').forEach(b => b.click());
      }).catch(() => {});

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${pg.name}.png`),
        fullPage: true,
      });
      console.log(`  ✓ ${pg.name}`);
    } catch (err) {
      console.error(`  ✗ ${pg.name}: ${err.message}`);
    }
  }

  // Process detail sub-tabs
  console.log('\nCapturing process detail tabs...');
  try {
    await page.goto(`${BASE_URL}/processos/263`, { waitUntil: 'networkidle', timeout: 20000 });
  } catch(e) { /* timeout ok */ }
  await page.waitForTimeout(3000);

  for (const tab of PROCESS_TABS) {
    console.log(`Capturing tab: ${tab.name} (${tab.tab})`);
    try {
      const tabButton = page.locator(`button, [role="tab"]`).filter({ hasText: tab.tab });
      if (await tabButton.count() > 0) {
        await tabButton.first().click();
        await page.waitForTimeout(2500);
      }
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${tab.name}.png`),
        fullPage: true,
      });
      console.log(`  ✓ ${tab.name}`);
    } catch (err) {
      console.error(`  ✗ ${tab.name}: ${err.message}`);
    }
  }

  // Sidebar screenshots
  console.log('\nCapturing sidebars...');
  await page.goto(`${BASE_URL}/importacao/dashboard`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '30_sidebar_importacao.png'),
    fullPage: false,
    clip: { x: 0, y: 0, width: 300, height: 1080 },
  });

  await page.goto(`${BASE_URL}/certificacoes/`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '31_sidebar_certificacoes.png'),
    fullPage: false,
    clip: { x: 0, y: 0, width: 300, height: 1080 },
  });

  await browser.close();
  console.log('\nDone! Screenshots saved to:', SCREENSHOTS_DIR);
}

main().catch(console.error);
