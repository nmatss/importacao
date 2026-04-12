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

async function capturePages(page, suffix = '', setDark = false) {
  // Capture login (no auth)
  if (!suffix.includes('dark')) {
    console.log(`Capturing: 01_login${suffix}`);
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
    } catch(e) {}
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `01_login${suffix}.png`), fullPage: true });
    console.log(`  ✓ 01_login${suffix}`);
  }

  // Inject auth
  await page.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.evaluate((token) => { localStorage.setItem('importacao_token', token); }, TOKEN);

  // Set dark mode if requested
  if (setDark) {
    await page.evaluate(() => {
      localStorage.setItem('theme', 'dark');
      document.documentElement.classList.add('dark');
    });
  } else {
    await page.evaluate(() => {
      localStorage.setItem('theme', 'light');
      document.documentElement.classList.remove('dark');
    });
  }

  await page.goto(`${BASE_URL}/portal`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Capture all pages
  for (const pg of PAGES) {
    if (pg.name === '01_login') continue;
    const fname = `${pg.name}${suffix}`;
    console.log(`Capturing: ${fname} (${pg.path})`);
    try {
      await page.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(pg.waitFor || 3000);
      await page.evaluate(() => {
        document.querySelectorAll('[role="dialog"] button[aria-label="Close"]').forEach(b => b.click());
        document.querySelectorAll('.Toastify__close-button').forEach(b => b.click());
      }).catch(() => {});
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${fname}.png`), fullPage: true });
      console.log(`  ✓ ${fname}`);
    } catch (err) {
      console.error(`  ✗ ${fname}: ${err.message}`);
    }
  }

  // Process detail tabs
  console.log('\nCapturing process detail tabs...');
  try {
    await page.goto(`${BASE_URL}/processos/263`, { waitUntil: 'networkidle', timeout: 20000 });
  } catch(e) {}
  await page.waitForTimeout(3000);

  for (const tab of PROCESS_TABS) {
    const fname = `${tab.name}${suffix}`;
    console.log(`Capturing tab: ${fname} (${tab.tab})`);
    try {
      const tabButton = page.locator(`button, [role="tab"]`).filter({ hasText: tab.tab });
      if (await tabButton.count() > 0) {
        await tabButton.first().click();
        await page.waitForTimeout(2500);
      }
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${fname}.png`), fullPage: true });
      console.log(`  ✓ ${fname}`);
    } catch (err) {
      console.error(`  ✗ ${fname}: ${err.message}`);
    }
  }

  // Sidebar
  await page.goto(`${BASE_URL}/importacao/dashboard`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `30_sidebar_importacao${suffix}.png`),
    fullPage: false,
    clip: { x: 0, y: 0, width: 300, height: 1080 },
  });
  await page.goto(`${BASE_URL}/certificacoes/`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `31_sidebar_certificacoes${suffix}.png`),
    fullPage: false,
    clip: { x: 0, y: 0, width: 300, height: 1080 },
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── Desktop LIGHT (1920x1080) ──
  console.log('\n═══ DESKTOP LIGHT (1920x1080) ═══\n');
  const desktopCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const desktopPage = await desktopCtx.newPage();
  await capturePages(desktopPage, '', false);
  await desktopCtx.close();

  // ── Desktop DARK (1920x1080) ──
  console.log('\n═══ DESKTOP DARK (1920x1080) ═══\n');
  const darkCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const darkPage = await darkCtx.newPage();
  await capturePages(darkPage, '_dark', true);
  await darkCtx.close();

  // ── Mobile (390x844 - iPhone 14) ──
  console.log('\n═══ MOBILE (390x844) ═══\n');
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileCtx.newPage();

  // Login mobile
  console.log('Capturing: 01_login_mobile');
  try {
    await mobilePage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  } catch(e) {}
  await mobilePage.waitForTimeout(2000);
  await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_login_mobile.png'), fullPage: true });

  // Auth
  await mobilePage.evaluate((token) => { localStorage.setItem('importacao_token', token); }, TOKEN);
  await mobilePage.evaluate(() => {
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.remove('dark');
  });

  // Key mobile pages
  const MOBILE_PAGES = [
    { name: '02_portal_mobile', path: '/portal', waitFor: 3000 },
    { name: '03_dashboard_mobile', path: '/importacao/dashboard', waitFor: 4000 },
    { name: '04_executivo_mobile', path: '/importacao/executivo', waitFor: 4000 },
    { name: '05_processos_mobile', path: '/importacao/processos', waitFor: 3000 },
    { name: '06_processo_detalhe_mobile', path: '/processos/263', waitFor: 3000 },
    { name: '13_follow_up_mobile', path: '/importacao/follow-up', waitFor: 3000 },
    { name: '19_meu_dia_mobile', path: '/importacao/meu-dia', waitFor: 3000 },
    { name: '20_cert_dashboard_mobile', path: '/certificacoes/', waitFor: 3000 },
  ];

  for (const pg of MOBILE_PAGES) {
    console.log(`Capturing: ${pg.name} (${pg.path})`);
    try {
      await mobilePage.goto(`${BASE_URL}${pg.path}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await mobilePage.waitForTimeout(pg.waitFor);
      await mobilePage.screenshot({ path: path.join(SCREENSHOTS_DIR, `${pg.name}.png`), fullPage: true });
      console.log(`  ✓ ${pg.name}`);
    } catch (err) {
      console.error(`  ✗ ${pg.name}: ${err.message}`);
    }
  }

  await mobileCtx.close();
  await browser.close();
  console.log('\nDone! All screenshots saved to:', SCREENSHOTS_DIR);
}

main().catch(console.error);
