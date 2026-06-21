/**
 * sydle-flow-audit.mjs — Auditoria READ-ONLY do fluxo de compra+pagamento intl.
 *
 * Faz, numa única sessão SYDLE (minimiza exposição da credencial — ver P0):
 *  1) MAPA DO FLUXO: amostra a classe de pagamentos com _source COMPLETO, lista
 *     todos os campos, coleta TODO _classId referenciado (grafo de classes do
 *     fluxo) e testa acesso (200/403) em cada uma — inclusive ticket/openForm,
 *     brand, recipient, enterprise, currency e as classes financeiras.
 *  2) DRY-RUN DO ENRIQUECIMENTO: para cada registro recente (os que aparecem na
 *     tela), resolve EXATAMENTE como o sync faria com a flag ligada —
 *       Caso A: requestData.processCode / invoiceCode / etc.
 *       Caso B: requestData.brand -> classe brand -> name
 *               requestData.recipient -> recipient -> enterprise -> legalName
 *     e imprime o que CADA coluna receberia. Nada é escrito. Prova o ganho antes
 *     de ligar SYDLE_ONE_ENRICH_FIELDS em produção.
 *
 * Estritamente read-only (signIn + _search). Redige valores sensíveis.
 * Rode dentro do container importacao-api (tem node + env SYDLE).
 */

// ── Config a partir do env do container ─────────────────────────────────────
const cfg = {
  baseUrl: process.env.SYDLE_BASE_URL ?? '',
  app: process.env.SYDLE_APP ?? 'main',
  user: process.env.SYDLE_USER ?? '',
  password: process.env.SYDLE_PASSWORD ?? '',
  paymentsClassId: process.env.SYDLE_CLASS_ID ?? '',
  ticketClassId: process.env.SYDLE_TICKET_CLASS_ID ?? '5d446dfc62d9656275a47d69',
  ticketStatusClassId: process.env.SYDLE_TICKET_STATUS_CLASS_ID ?? '5cacdc04a50bfe4c0d3e5c74',
  currencyClassId: process.env.SYDLE_CURRENCY_CLASS_ID ?? '000000000000000000000059',
  brandClassId: process.env.SYDLE_BRAND_CLASS_ID ?? '685179c16732f5038aaed372',
  recipientClassId: process.env.SYDLE_RECIPIENT_CLASS_ID ?? '689cd3bd27624d322604be16',
  enterpriseClassId: process.env.SYDLE_ENTERPRISE_CLASS_ID ?? '591365fef5ca53284cd8d159',
  dateField: process.env.SYDLE_DATE_FIELD ?? '_lastUpdateDate',
  timeoutMs: Number(process.env.SYDLE_TIMEOUT_MS ?? 30_000) || 30_000,
  sample: Number(process.env.SYDLE_AUDIT_SAMPLE ?? 8) || 8,
};

const SECRET_KEY = /(authorization|token|secret|password|senha|account|conta|agency|agencia|iban|routing|pix|cookie|swift|cpf|cnpj)/i;
function redact(key, value) {
  if (SECRET_KEY.test(String(key))) return '«redacted»';
  if (typeof value === 'string') return value.length > 90 ? `${value.slice(0, 87)}…` : value;
  return value;
}

// ── Field keys (espelha apps/api/src/modules/sydle/normalizer.ts) ───────────
const FIELD_KEYS = {
  processCode: ['processCode', 'process_code', 'processo', 'codigoProcesso', 'codProcesso', 'process'],
  purchaseOrder: ['purchaseOrder', 'purchase_order', 'po', 'poNumber', 'numeroPedido', 'pedidoCompra', 'ordemCompra'],
  proformaNumber: ['proformaNumber', 'proforma', 'piNumber', 'pi', 'numeroPi', 'proformaInvoice'],
  invoiceNumber: ['invoiceNumber', 'invoice', 'invoiceCode', 'commercialInvoice', 'ciNumber', 'numeroInvoice'],
  supplierName: ['supplierName', 'supplier', 'fornecedor', 'exportador', 'shipper', 'vendor'],
  brand: ['brand', 'marca', 'businessUnit', 'unidade'],
  exchangeRate: ['exchangeRate', 'taxaCambio', 'taxa', 'ptax'],
  amountBrl: ['amountBrl', 'valorBrl', 'valorReal', 'valorReais'],
  bankName: ['bankName', 'banco', 'bank'],
  contractNumber: ['contractNumber', 'contratoCambio', 'contrato', 'exchangeContract'],
  remittanceId: ['remittanceId', 'remessa', 'swift', 'remittance'],
};
const COMPLEMENTARY = Object.keys(FIELD_KEYS);

function normalizeKey(key) {
  return String(key).normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}
function findValue(obj, candidates) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const cand of candidates) if (cand in obj) return obj[cand];
  const wanted = new Set(candidates.map(normalizeKey));
  for (const [k, v] of Object.entries(obj)) if (wanted.has(normalizeKey(k))) return v;
  return undefined;
}
function scalarOnly(v) {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(t); }
}

async function signIn() {
  const url = new URL(`/api/1/${cfg.app}/sys/auth/signIn`, cfg.baseUrl);
  url.searchParams.set('login', cfg.user);
  url.searchParams.set('password', cfg.password);
  const res = await timedFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`signIn falhou: HTTP ${res.status}`);
  const payload = await res.json().catch(() => null);
  const rawCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = rawCookies.map((c) => c.split(';')[0]?.trim()).filter(Boolean).join('; ');
  let token = null;
  if (payload && typeof payload === 'object') {
    const at = payload.accessToken;
    if (typeof at === 'string') token = at;
    else if (at && typeof at === 'object' && typeof at.token === 'string') token = at.token;
    token = token || payload.token || payload.access_token || null;
  }
  if (!cookie && !token) throw new Error('signIn ok mas sem cookie nem accessToken');
  return {
    Accept: 'application/json', 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function search(classId, headers, body) {
  const url = new URL(`/api/1/${cfg.app}/_classId/${classId}/_search`, cfg.baseUrl);
  let res;
  try { res = await timedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { return { status: 0, ok: false, error: String(e?.message ?? e), records: [] }; }
  if (!res.ok) return { status: res.status, ok: false, records: [] };
  const payload = await res.json().catch(() => null);
  const hits = payload?.hits?.hits ?? (Array.isArray(payload?.hits) ? payload.hits : []);
  const records = hits.map((h) => ({
    _id: h?._id ?? h?._source?._id,
    _classId: h?._classId ?? h?._source?._classId,
    ...(h?._source && typeof h._source === 'object' ? h._source : {}),
  }));
  return { status: res.status, ok: true, records };
}
async function byIds(classId, ids, headers, includes) {
  if (!ids.length) return new Map();
  const r = await search(classId, headers, {
    size: Math.min(ids.length, 1000), query: { terms: { _id: ids } },
    _source: includes ? { includes } : undefined,
  });
  const map = new Map();
  if (r.ok) for (const rec of r.records) if (rec._id) map.set(String(rec._id), rec);
  return { map, status: r.status, ok: r.ok };
}

// ── Introspecção ─────────────────────────────────────────────────────────────
function flattenKeys(obj, prefix = '', out = {}, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    out[`${prefix}[]`] = `array(${obj.length})`;
    if (obj.length && typeof obj[0] === 'object') flattenKeys(obj[0], `${prefix}[]`, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') { out[path] = Array.isArray(v) ? `array(${v.length})` : 'object'; flattenKeys(v, path, out, depth + 1); }
    else out[path] = v === null ? 'null' : typeof v;
  }
  return out;
}
function collectClassRefs(obj, refs = new Map(), pathStack = [], depth = 0) {
  if (depth > 7 || obj === null || typeof obj !== 'object') return refs;
  if (Array.isArray(obj)) { for (const it of obj) collectClassRefs(it, refs, pathStack, depth + 1); return refs; }
  const classId = obj._classId;
  if (typeof classId === 'string' && classId && obj._id) {
    if (!refs.has(classId)) refs.set(classId, new Set());
    refs.get(classId).add(pathStack.join('.') || '(root)');
  }
  for (const [k, v] of Object.entries(obj)) if (v && typeof v === 'object') collectClassRefs(v, refs, [...pathStack, k], depth + 1);
  return refs;
}
function get(obj, path) { let c = obj; for (const s of path) { if (!c || typeof c !== 'object') return undefined; c = c[s]; } return c; }
function str(v) { return v === null || v === undefined ? null : (String(v).trim() || null); }

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const miss = [];
  for (const k of ['baseUrl', 'user', 'password', 'paymentsClassId']) if (!cfg[k]) miss.push(k);
  if (miss.length) { console.error(`[audit] faltam: ${miss.join(', ')}`); process.exit(2); }

  console.log(`[audit] base=${cfg.baseUrl} app=${cfg.app} user=${cfg.user}`);
  const headers = await signIn();
  console.log('[audit] autenticado.\n');

  // 1) Amostra recente da classe de pagamentos (os registros da tela)
  const sample = await search(cfg.paymentsClassId, headers, {
    size: cfg.sample, query: { match_all: {} },
    sort: [{ [cfg.dateField]: { order: 'desc' } }, { _id: { order: 'desc' } }],
  });
  if (!sample.ok) { console.error(`[audit] sem acesso à classe de pagamentos: HTTP ${sample.status}`); process.exit(1); }
  console.log(`== 1) MAPA DO FLUXO ==`);
  console.log(`Classe de pagamentos ${cfg.paymentsClassId}: ${sample.records.length} registros amostrados`);

  const merged = {};
  for (const r of sample.records) Object.assign(merged, flattenKeys(r));
  const keyPaths = Object.keys(merged).sort();
  console.log(`Campos distintos no payload: ${keyPaths.length}`);
  console.log('Campos de topo + requestData.*:');
  for (const p of keyPaths.filter((p) => !p.includes('[]') && (p.split('.').length <= 2)).slice(0, 200)) {
    console.log(`   ${p}: ${merged[p]}`);
  }

  // grafo de classes referenciadas
  const refs = new Map();
  for (const r of sample.records) collectClassRefs(r, refs);
  const known = {
    [cfg.paymentsClassId]: 'pagamentos', [cfg.ticketClassId]: 'ticket',
    [cfg.ticketStatusClassId]: 'ticket_status', [cfg.currencyClassId]: 'currency',
    [cfg.brandClassId]: 'brand', [cfg.recipientClassId]: 'recipient', [cfg.enterpriseClassId]: 'enterprise',
  };
  const candidates = new Map();
  for (const [id, label] of Object.entries(known)) candidates.set(id, { label, paths: new Set() });
  for (const [id, paths] of refs) {
    if (!candidates.has(id)) candidates.set(id, { label: 'auto-descoberta', paths: new Set() });
    for (const p of paths) candidates.get(id).paths.add(p);
  }

  console.log(`\n== Acesso de leitura por classe (todas as do fluxo) ==`);
  const classReport = [];
  for (const [id, meta] of candidates) {
    const probe = await search(id, headers, { size: 1, query: { match_all: {} }, _source: { includes: ['_id'] } });
    const tag = probe.ok ? '200 OK' : `${probe.status}`;
    const flag = probe.ok ? '✓ legível' : (probe.status === 403 || probe.status === 401) ? '✗ BLOQUEADA' : '? erro';
    classReport.push({ id, label: meta.label, status: probe.status, readable: probe.ok, refPaths: [...meta.paths].slice(0, 6) });
    console.log(`  [${tag.padEnd(6)}] ${flag.padEnd(12)} ${id}  (${meta.label})  ← ${[...meta.paths].slice(0, 4).join(', ') || 'classe base/lookup'}`);
  }

  // 2) DRY-RUN do enriquecimento sobre os mesmos registros
  console.log(`\n== 2) DRY-RUN DO ENRIQUECIMENTO (o que a flag ligada preencheria) ==`);

  // lookups Caso B
  const brandIds = [...new Set(sample.records.map((r) => str(get(r, ['requestData', 'brand', '_id']))).filter(Boolean))];
  const recipientIds = [...new Set(sample.records.map((r) => str(get(r, ['requestData', 'recipient', '_id']))).filter(Boolean))];
  const brandRes = await byIds(cfg.brandClassId, brandIds, headers, ['_id', 'name']);
  const recipientRes = await byIds(cfg.recipientClassId, recipientIds, headers, ['_id', 'name', 'enterprise']);
  const enterpriseIds = [...new Set([...recipientRes.map.values()].map((r) => str(get(r, ['enterprise', '_id']))).filter(Boolean))];
  const enterpriseRes = await byIds(cfg.enterpriseClassId, enterpriseIds, headers, ['_id', 'legalName', 'name']);
  // tickets (para openForm + code)
  const ticketIds = [...new Set(sample.records.map((r) => str(get(r, ['ticket', '_id']))).filter(Boolean))];
  const ticketRes = await byIds(cfg.ticketClassId, ticketIds, headers, ['_id', 'code', 'searchCode', 'openForm', 'status']);
  console.log(`lookups: brand ${brandRes.status}, recipient ${recipientRes.status}, enterprise ${enterpriseRes.status}, ticket ${ticketRes.status}\n`);

  let wouldMatchByProcess = 0, wouldHaveSupplier = 0, wouldHaveInvoice = 0;
  for (const rec of sample.records) {
    const requestData = (rec.requestData && typeof rec.requestData === 'object') ? rec.requestData : {};
    const ticket = ticketRes.map.get(str(get(rec, ['ticket', '_id'])) ?? '') ?? null;
    const openForm = (ticket?.openForm && typeof ticket.openForm === 'object') ? ticket.openForm : {};
    const surface = { ...(ticket ?? {}), ...openForm, ...rec, ...requestData };

    // Caso A
    const caseA = {};
    for (const field of COMPLEMENTARY) {
      const v = scalarOnly(findValue(surface, FIELD_KEYS[field]));
      if (v !== undefined) caseA[field] = v;
    }
    // Caso B
    const brand = brandRes.map.get(str(get(requestData, ['brand', '_id'])) ?? '');
    const recipient = recipientRes.map.get(str(get(requestData, ['recipient', '_id'])) ?? '');
    const enterprise = recipient ? enterpriseRes.map.get(str(get(recipient, ['enterprise', '_id'])) ?? '') : null;
    const caseB = {};
    if (brand?.name) caseB.brand = brand.name;
    if (enterprise?.legalName) caseB.supplierName = enterprise.legalName;

    const filled = { ...caseA, ...caseB }; // classe vizinha prevalece
    const ticketCode = str(ticket?.code) ?? str(ticket?.searchCode);
    if (filled.processCode) wouldMatchByProcess += 1;
    if (filled.supplierName) wouldHaveSupplier += 1;
    if (filled.invoiceNumber) wouldHaveInvoice += 1;

    console.log(`• SYDLE-${ticketCode ?? '?'} (req ${str(rec._id)})`);
    const show = (label, key) => console.log(`    ${label.padEnd(14)}: ${filled[key] !== undefined ? redact(key, filled[key]) : '— (vazio)'}`);
    show('processCode', 'processCode');
    show('invoiceNumber', 'invoiceNumber');
    show('proformaNumber', 'proformaNumber');
    show('purchaseOrder', 'purchaseOrder');
    show('brand', 'brand');
    show('supplierName', 'supplierName');
    show('exchangeRate', 'exchangeRate');
    show('amountBrl', 'amountBrl');
    show('bankName', 'bankName');
    show('contractNumber', 'contractNumber');
    show('remittanceId', 'remittanceId');
  }

  console.log(`\n== VEREDICTO ==`);
  console.log(`Registros amostrados: ${sample.records.length}`);
  console.log(`Ganhariam processCode (→ match exato): ${wouldMatchByProcess}`);
  console.log(`Ganhariam supplierName: ${wouldHaveSupplier}`);
  console.log(`Ganhariam invoiceNumber: ${wouldHaveInvoice}`);
  const blocked = classReport.filter((c) => !c.readable);
  console.log(`Classes do fluxo BLOQUEADAS (403/401): ${blocked.map((c) => c.id).join(', ') || '(nenhuma)'}`);
}

main().catch((e) => { console.error(`[audit] FALHA: ${e?.message ?? e}`); process.exit(1); });
