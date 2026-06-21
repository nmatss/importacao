/**
 * sydle-unblock-probe.mjs — Tenta DESTRAVAR os campos financeiros (read-only).
 *
 * Duas frentes numa só sessão:
 *  1) CAMPOS ESCONDIDOS: dump COMPLETO (sem excludes) de um registro de pagamento
 *     + seu ticket + openForm + requestData, e procura QUALQUER campo financeiro
 *     por regex amplo (cambio/cotacao/taxa/dolar/real/brl/banco/swift/contrato/
 *     remessa/proforma/pi/fechamento/ptax). Se achar em classe legível → Caso A.
 *  2) LEITURA POR ID das classes 403: para o `_concreteObject._id` (classe …5efb)
 *     e cada `processInstanceControl.activeElements[]._id` (classe 64f22b57…),
 *     tenta vários endpoints (terms _id, GET por id, GET global) — ACL de search
 *     pode diferir de ACL de leitura de objeto referenciado.
 *
 * Estritamente read-only. Redige valores sensíveis.
 */

const cfg = {
  baseUrl: process.env.SYDLE_BASE_URL ?? '',
  app: process.env.SYDLE_APP ?? 'main',
  user: process.env.SYDLE_USER ?? '',
  password: process.env.SYDLE_PASSWORD ?? '',
  paymentsClassId: process.env.SYDLE_CLASS_ID ?? '',
  ticketClassId: process.env.SYDLE_TICKET_CLASS_ID ?? '5d446dfc62d9656275a47d69',
  timeoutMs: Number(process.env.SYDLE_TIMEOUT_MS ?? 30_000) || 30_000,
};

const FIN_RE = /cambio|c[âa]mbio|cota[çc]|taxa|d[óo]lar|dolar|\breal\b|reais|\bbrl\b|banco|\bbank\b|swift|\biban\b|remess|remit|contrato|contract|proforma|\bpi\b|fechamento|ptax|recebedor|benefici|valorrec|exchange|rate|wire/i;
const SECRET_KEY = /(authorization|token|secret|password|senha|account|conta|agency|agencia|iban|routing|pix|cookie|swift|cpf|cnpj)/i;
const redact = (k, v) => (SECRET_KEY.test(String(k)) ? '«red»' : typeof v === 'string' && v.length > 80 ? v.slice(0, 77) + '…' : v);

async function tfetch(url, init = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), cfg.timeoutMs);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}
async function signIn() {
  const url = new URL(`/api/1/${cfg.app}/sys/auth/signIn`, cfg.baseUrl);
  url.searchParams.set('login', cfg.user); url.searchParams.set('password', cfg.password);
  const res = await tfetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`signIn HTTP ${res.status}`);
  const payload = await res.json().catch(() => null);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]?.trim()).filter(Boolean).join('; ');
  let token = null;
  if (payload?.accessToken) token = typeof payload.accessToken === 'string' ? payload.accessToken : payload.accessToken.token;
  token = token || payload?.token || payload?.access_token || null;
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function search(classId, headers, body) {
  const url = new URL(`/api/1/${cfg.app}/_classId/${classId}/_search`, cfg.baseUrl);
  let res; try { res = await tfetch(url, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { return { status: 0, ok: false, records: [], err: String(e?.message ?? e) }; }
  if (!res.ok) return { status: res.status, ok: false, records: [] };
  const p = await res.json().catch(() => null);
  const hits = p?.hits?.hits ?? (Array.isArray(p?.hits) ? p.hits : []);
  return { status: res.status, ok: true, records: hits.map((h) => ({ _id: h?._id ?? h?._source?._id, _classId: h?._classId, ...(h?._source ?? {}) })) };
}
async function rawGet(path, headers) {
  const url = new URL(path, cfg.baseUrl);
  let res; try { res = await tfetch(url, { headers }); } catch (e) { return { status: 0, ok: false, err: String(e?.message ?? e) }; }
  let body = null; try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ok: res.ok, body };
}

// achata em [{path, value}] só folhas primitivas
function leaves(obj, prefix = '', out = [], depth = 0) {
  if (depth > 8 || obj == null) return out;
  if (Array.isArray(obj)) { obj.forEach((v, i) => leaves(v, `${prefix}[${i}]`, out, depth + 1)); return out; }
  if (typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) leaves(v, prefix ? `${prefix}.${k}` : k, out, depth + 1); return out; }
  out.push({ path: prefix, value: obj });
  return out;
}
function get(o, path) { let c = o; for (const s of path) { if (!c || typeof c !== 'object') return undefined; c = c[s]; } return c; }
const str = (v) => (v == null ? null : String(v).trim() || null);

async function main() {
  for (const k of ['baseUrl', 'user', 'password', 'paymentsClassId']) if (!cfg[k]) { console.error(`falta ${k}`); process.exit(2); }
  console.log(`[unblock] base=${cfg.baseUrl} app=${cfg.app} user=${cfg.user}`);
  const headers = await signIn();
  console.log('[unblock] autenticado.\n');

  // pega alguns registros recentes com _source COMPLETO (sem excludes)
  const sample = await search(cfg.paymentsClassId, headers, {
    size: 5, query: { match_all: {} },
    sort: [{ _lastUpdateDate: { order: 'desc' } }, { _id: { order: 'desc' } }],
  });
  if (!sample.ok) { console.error(`sem acesso à classe de pagamentos: ${sample.status}`); process.exit(1); }

  // ── 1) CAMPOS FINANCEIROS ESCONDIDOS (em classes legíveis) ──
  console.log('== 1) Procura de campos financeiros em classes LEGÍVEIS ==');
  const finHits = new Map(); // path -> exemplo de valor
  for (const rec of sample.records) {
    // ticket + openForm (classe legível)
    const ticketId = str(get(rec, ['ticket', '_id']));
    let ticket = null;
    if (ticketId) {
      const tr = await search(cfg.ticketClassId, headers, { size: 1, query: { terms: { _id: [ticketId] } } });
      ticket = tr.ok ? tr.records[0] : null;
    }
    const surface = { payment: rec, ticket };
    for (const { path, value } of leaves(surface)) {
      if (FIN_RE.test(path) || (typeof value === 'string' && value.length < 40 && FIN_RE.test(value))) {
        if (!finHits.has(path)) finHits.set(path, redact(path, value));
      }
    }
  }
  if (finHits.size) {
    console.log(`  ACHADOS ${finHits.size} campos candidatos a financeiro (path: valor):`);
    for (const [p, v] of [...finHits].slice(0, 80)) console.log(`   [?] ${p} = ${v}`);
  } else {
    console.log('  NENHUM campo financeiro em classes legíveis (payment/ticket/openForm).');
  }

  // ── 2) LEITURA POR ID das classes 403 ──
  console.log('\n== 2) Tentativa de leitura por ID das classes 403 ==');
  const rec0 = sample.records[0];
  const targets = [];
  const concrete = get(rec0, ['_concreteObject']);
  if (concrete?._id) targets.push({ label: '_concreteObject', id: str(concrete._id), classId: str(concrete._classId) });
  const acts = get(rec0, ['processInstanceControl', 'activeElements']);
  if (Array.isArray(acts)) acts.forEach((a, i) => { if (a?._id) targets.push({ label: `activeElements[${i}]`, id: str(a._id), classId: str(a._classId) }); });

  for (const t of targets) {
    console.log(`\n  alvo ${t.label}: id=${t.id} class=${t.classId}`);
    // a) search terms _id
    const s = await search(t.classId, headers, { size: 1, query: { terms: { _id: [t.id] } } });
    console.log(`   a) _search terms _id  -> HTTP ${s.status}${s.ok ? ` (${s.records.length} rec)` : ''}`);
    if (s.ok && s.records[0]) {
      const finite = leaves(s.records[0]).filter((l) => FIN_RE.test(l.path));
      console.log(`      campos financeiros no objeto: ${finite.length ? finite.map((l) => `${l.path}=${redact(l.path, l.value)}`).slice(0, 30).join(' | ') : '(nenhum)'}`);
    }
    // b) GET /api/1/{app}/_classId/{classId}/{id}
    const g1 = await rawGet(`/api/1/${cfg.app}/_classId/${t.classId}/${t.id}`, headers);
    console.log(`   b) GET _classId/{id}  -> HTTP ${g1.status}`);
    if (g1.ok && g1.body) {
      const finite = leaves(g1.body).filter((l) => FIN_RE.test(l.path));
      console.log(`      campos financeiros: ${finite.length ? finite.map((l) => `${l.path}=${redact(l.path, l.value)}`).slice(0, 30).join(' | ') : '(nenhum)'}`);
    }
    // c) GET global /api/1/{app}/{id}
    const g2 = await rawGet(`/api/1/${cfg.app}/${t.id}`, headers);
    console.log(`   c) GET global {id}    -> HTTP ${g2.status}`);
    if (g2.ok && g2.body) {
      const finite = leaves(g2.body).filter((l) => FIN_RE.test(l.path));
      console.log(`      campos financeiros: ${finite.length ? finite.map((l) => `${l.path}=${redact(l.path, l.value)}`).slice(0, 30).join(' | ') : '(nenhum)'}`);
    }
  }

  console.log('\n== VEREDICTO ==');
  console.log(finHits.size
    ? `Há ${finHits.size} campos financeiros em classe LEGÍVEL → dá pra destravar via Caso A (mapear no FIELD_KEYS).`
    : 'Nenhum campo financeiro em classe legível; depende das leituras por ID acima (ver status).');
}
main().catch((e) => { console.error(`[unblock] FALHA: ${e?.message ?? e}`); process.exit(1); });
