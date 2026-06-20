/**
 * sydle-class-discovery.mjs — Probe READ-ONLY de descoberta da SYDLE One.
 *
 * Objetivo: responder empiricamente "o que dá pra harvestar para a base?".
 *  1. Descobre CAMPOS: puxa amostras da classe de pagamentos com _source completo
 *     (sem os excludes de sanitização do client) e lista todas as chaves, para
 *     revelar campos complementares (fornecedor/PI/invoice/processo/câmbio/banco)
 *     que talvez já venham no payload e só não estejam mapeados no normalizer.
 *  2. Auto-descobre CLASSES vizinhas: coleta todo `_classId` referenciado nas
 *     amostras (objetos com {_id, _classId}).
 *  3. Testa ACESSO: faz um _search mínimo (size:1, match_all) em cada classe
 *     candidata e reporta HTTP 200 (legível) vs 401/403 (sem permissão).
 *
 * É estritamente read-only: só usa signIn + _search. Nenhuma escrita.
 *
 * SECURITY CAVEAT (P0 ABERTO): o signIn da SYDLE One só aceita GET com
 * login/senha na query string (POST -> 405). A URL pode vazar em logs de
 * proxy/WAF. Este script NUNCA imprime a senha e redige a query string ao logar.
 * Mesmo assim, rode em ambiente confiável e considere rotacionar SYDLE_PASSWORD
 * depois. Ver docs/KNOWN_ISSUES.md.
 *
 * Uso (no servidor, onde o .env já tem as credenciais SYDLE):
 *   cd /caminho/do/projeto
 *   node scripts/sydle-class-discovery.mjs
 *
 * Ou apontando um env alternativo:
 *   SYDLE_DISCOVERY_ENV=/caminho/secrets.env node scripts/sydle-class-discovery.mjs
 *
 * Saída: resumo no console + relatório JSON em scripts/out/sydle-discovery-<ts>.json
 *        (chaves/estrutura; valores de campos sensíveis são redigidos).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ── Carrega .env (sem sobrescrever env já exportado) ────────────────────────
try {
  const dotenv = await import('dotenv');
  dotenv.config({ path: join(PROJECT_ROOT, '.env') });
  if (process.env.SYDLE_DISCOVERY_ENV) {
    dotenv.config({ path: process.env.SYDLE_DISCOVERY_ENV });
  }
} catch {
  // dotenv ausente: seguimos só com o env do processo.
}

// ── Config ──────────────────────────────────────────────────────────────────
const cfg = {
  baseUrl: process.env.SYDLE_BASE_URL ?? '',
  app: process.env.SYDLE_APP ?? 'main',
  user: process.env.SYDLE_USER ?? '',
  password: process.env.SYDLE_PASSWORD ?? '',
  paymentsClassId: process.env.SYDLE_CLASS_ID ?? '',
  ticketClassId: process.env.SYDLE_TICKET_CLASS_ID ?? '5d446dfc62d9656275a47d69',
  ticketStatusClassId: process.env.SYDLE_TICKET_STATUS_CLASS_ID ?? '5cacdc04a50bfe4c0d3e5c74',
  currencyClassId: process.env.SYDLE_CURRENCY_CLASS_ID ?? '000000000000000000000059',
  timeoutMs: Number(process.env.SYDLE_TIMEOUT_MS ?? 30_000) || 30_000,
  sampleSize: Number(process.env.SYDLE_DISCOVERY_SAMPLE ?? 3) || 3,
};

const missing = [];
if (!cfg.baseUrl) missing.push('SYDLE_BASE_URL');
if (!cfg.app) missing.push('SYDLE_APP');
if (!cfg.user) missing.push('SYDLE_USER');
if (!cfg.password) missing.push('SYDLE_PASSWORD');
if (!cfg.paymentsClassId) missing.push('SYDLE_CLASS_ID');
if (missing.length) {
  console.error(
    `\n[sydle-discovery] credenciais ausentes: ${missing.join(', ')}.\n` +
      `Rode no servidor onde o .env tem as vars SYDLE, ou:\n` +
      `  SYDLE_DISCOVERY_ENV=/caminho/secrets.env node scripts/sydle-class-discovery.mjs\n`,
  );
  process.exit(2);
}

// ── Redação de segredos ─────────────────────────────────────────────────────
const SECRET_KEY = /(authorization|token|secret|password|senha|account|conta|agency|agencia|iban|routing|pix|cookie|swift|cpf|cnpj)/i;

function redactValue(key, value) {
  if (SECRET_KEY.test(key)) return '«redacted»';
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  }
  return value;
}

function redactUrl(url) {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) {
    if (/login|password|senha|token/i.test(k)) u.searchParams.set(k, '«redacted»');
  }
  return u.toString();
}

// ── HTTP ──────────────────────────────────────────────────────────────────
async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function signIn() {
  const url = new URL(`/api/1/${cfg.app}/sys/auth/signIn`, cfg.baseUrl);
  url.searchParams.set('login', cfg.user);
  url.searchParams.set('password', cfg.password);
  console.log(`[sydle-discovery] signIn -> ${redactUrl(url.toString())}`);

  const res = await timedFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`signIn falhou: HTTP ${res.status}`);
  const payload = await res.json().catch(() => null);

  // cookie de sessão
  const rawCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = rawCookies
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
  // accessToken
  let token = null;
  if (payload && typeof payload === 'object') {
    const at = payload.accessToken;
    if (typeof at === 'string') token = at;
    else if (at && typeof at === 'object' && typeof at.token === 'string') token = at.token;
    token = token || payload.token || payload.access_token || null;
  }
  if (!cookie && !token) throw new Error('signIn ok mas sem cookie nem accessToken');

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** _search mínimo numa classe. Retorna {status, ok, records} sem lançar em 401/403. */
async function searchClass(classId, headers, { size = 1, fullSource = false } = {}) {
  const url = new URL(`/api/1/${cfg.app}/_classId/${classId}/_search`, cfg.baseUrl);
  const body = { size, query: { match_all: {} } };
  if (!fullSource) {
    // só metadados leves quando não precisamos do conteúdo completo
    body._source = { includes: ['_id', '_classId', '_creationDate', '_lastUpdateDate'] };
  }
  let res;
  try {
    res = await timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    return { status: 0, ok: false, error: String(e?.message ?? e), records: [] };
  }
  if (!res.ok) {
    return { status: res.status, ok: false, records: [] };
  }
  const payload = await res.json().catch(() => null);
  const hits = payload?.hits?.hits ?? (Array.isArray(payload?.hits) ? payload.hits : []);
  const records = hits.map((h) => ({
    _id: h?._id ?? h?._source?._id,
    _classId: h?._classId ?? h?._source?._classId,
    ...(h?._source && typeof h._source === 'object' ? h._source : {}),
  }));
  return { status: res.status, ok: true, records };
}

// ── Introspecção de payload ─────────────────────────────────────────────────

/** Achata um objeto em {path: typeLabel}, limitando profundidade. */
function flattenKeys(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    out[`${prefix}[]`] = `array(${obj.length})`;
    if (obj.length && typeof obj[0] === 'object') flattenKeys(obj[0], `${prefix}[]`, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      out[path] = Array.isArray(v) ? `array(${v.length})` : 'object';
      flattenKeys(v, path, out, depth + 1);
    } else {
      out[path] = v === null ? 'null' : typeof v;
    }
  }
  return out;
}

/** Coleta {_classId} de objetos aninhados que referenciam outras classes. */
function collectClassRefs(obj, refs = new Map(), depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return refs;
  if (Array.isArray(obj)) {
    for (const item of obj) collectClassRefs(item, refs, depth + 1);
    return refs;
  }
  const classId = obj._classId;
  if (typeof classId === 'string' && classId && obj._id) {
    if (!refs.has(classId)) refs.set(classId, new Set());
    for (const k of Object.keys(obj)) refs.get(classId).add(k);
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') collectClassRefs(v, refs, depth + 1);
  }
  return refs;
}

// Campos complementares que queremos no cruzamento (heurística por nome).
const WANTED = {
  fornecedor: /supplier|fornecedor|exportador|shipper|vendor/i,
  proforma_pi: /proforma|(\b|_)pi(\b|_)|numeropi/i,
  invoice_ci: /invoice|commercialinvoice|(\b|_)ci(\b|_)|nota.?fiscal/i,
  processo: /process|processo|codigoprocesso/i,
  cambio: /exchange|cambio|câmbio|ptax|taxa|rate/i,
  valor_brl: /brl|valorreal|valorreais|amountbrl/i,
  banco: /\bbank\b|banco/i,
  contrato: /contract|contrato/i,
  remessa: /remit|remessa|swift|wire/i,
};

function classifyWanted(keyPaths) {
  const found = {};
  for (const [label, re] of Object.entries(WANTED)) {
    const hits = keyPaths.filter((p) => re.test(p));
    if (hits.length) found[label] = hits;
  }
  return found;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[sydle-discovery] base=${cfg.baseUrl} app=${cfg.app} user=${cfg.user}`);
  const headers = await signIn();
  console.log('[sydle-discovery] autenticado.\n');

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: cfg.baseUrl,
    app: cfg.app,
    paymentSample: null,
    fieldGapAnalysis: null,
    classAccess: [],
  };

  // 1) Amostra COMPLETA da classe de pagamentos
  console.log(`== Amostra da classe de pagamentos (${cfg.paymentsClassId}) ==`);
  const sample = await searchClass(cfg.paymentsClassId, headers, {
    size: cfg.sampleSize,
    fullSource: true,
  });
  if (!sample.ok) {
    console.error(`  !! sem acesso: HTTP ${sample.status}${sample.error ? ` (${sample.error})` : ''}`);
    report.paymentSample = { status: sample.status, error: sample.error ?? null };
  } else {
    console.log(`  registros amostrados: ${sample.records.length}`);
    const merged = {};
    for (const rec of sample.records) Object.assign(merged, flattenKeys(rec));
    const keyPaths = Object.keys(merged).sort();
    console.log(`  campos distintos no payload: ${keyPaths.length}`);

    const wanted = classifyWanted(keyPaths);
    report.fieldGapAnalysis = wanted;
    console.log('\n  -- Campos complementares encontrados no payload bruto --');
    for (const label of Object.keys(WANTED)) {
      if (wanted[label]) {
        console.log(`   [OK]    ${label}: ${wanted[label].slice(0, 5).join(', ')}`);
      } else {
        console.log(`   [falta] ${label}: (nenhum campo casou)`);
      }
    }

    // amostra de valores redigida (1º registro)
    const first = sample.records[0] ?? {};
    const flatFirst = flattenKeys(first);
    const sampleValues = {};
    for (const path of Object.keys(flatFirst)) {
      // pega valor escalar real via caminho simples (sem índices de array)
      if (!path.includes('[]') && flatFirst[path] !== 'object') {
        const val = path.split('.').reduce((o, k) => (o == null ? o : o[k]), first);
        if (val !== undefined) sampleValues[path] = redactValue(path, val);
      }
    }

    report.paymentSample = {
      status: sample.status,
      sampledRecords: sample.records.length,
      keyPaths,
      keyTypes: merged,
      firstRecordValues: sampleValues,
    };
  }

  // 2) Classes candidatas: conhecidas + auto-descobertas nas amostras
  const candidates = new Map(); // classId -> { label, viaKeys }
  const addCandidate = (id, label, keys = []) => {
    if (!id) return;
    if (!candidates.has(id)) candidates.set(id, { label, viaKeys: new Set() });
    for (const k of keys) candidates.get(id).viaKeys.add(k);
  };
  addCandidate(cfg.paymentsClassId, 'pagamentos (SYDLE_CLASS_ID)');
  addCandidate(cfg.ticketClassId, 'ticket');
  addCandidate(cfg.ticketStatusClassId, 'ticket_status');
  addCandidate(cfg.currencyClassId, 'currency');
  if (sample.ok) {
    const refs = new Map();
    for (const rec of sample.records) collectClassRefs(rec, refs);
    for (const [classId, keys] of refs) {
      addCandidate(classId, 'auto-descoberta', [...keys]);
    }
  }

  // 3) Testa acesso de leitura em cada classe candidata
  console.log('\n== Acesso de leitura por classe ==');
  for (const [classId, meta] of candidates) {
    const probe = await searchClass(classId, headers, { size: 1, fullSource: false });
    const readable = probe.ok;
    const keyCount = readable && probe.records[0] ? Object.keys(probe.records[0]).length : 0;
    const line = {
      classId,
      label: meta.label,
      referencedBy: [...meta.viaKeys].slice(0, 8),
      status: probe.status,
      readable,
      sampleKeyCount: keyCount,
      error: probe.error ?? null,
    };
    report.classAccess.push(line);
    const tag = readable ? '200 OK ' : `${String(probe.status).padStart(3)}    `;
    const flag = readable ? '✓ legível' : probe.status === 403 || probe.status === 401 ? '✗ bloqueada' : '? erro';
    console.log(`  [${tag}] ${flag.padEnd(12)} ${classId}  (${meta.label})`);
  }

  // 4) Persiste relatório
  const outDir = join(PROJECT_ROOT, 'scripts', 'out');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(outDir, `sydle-discovery-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[sydle-discovery] relatório salvo em ${outPath}`);

  // 5) Veredicto rápido
  const blocked = report.classAccess.filter((c) => !c.readable);
  const readableExtra = report.classAccess.filter(
    (c) => c.readable && c.label === 'auto-descoberta',
  );
  console.log('\n== Veredicto ==');
  console.log(`  classes legíveis além do esperado: ${readableExtra.length}`);
  console.log(`  classes bloqueadas (403/401/erro): ${blocked.length}`);
  if (report.fieldGapAnalysis) {
    const present = Object.keys(report.fieldGapAnalysis);
    const absent = Object.keys(WANTED).filter((k) => !present.includes(k));
    console.log(`  campos complementares JÁ no payload: ${present.join(', ') || '(nenhum)'}`);
    console.log(`  campos complementares ausentes: ${absent.join(', ') || '(nenhum)'}`);
  }
}

main().catch((err) => {
  console.error(`\n[sydle-discovery] FALHA: ${err?.message ?? err}`);
  process.exit(1);
});
