/**
 * Create the three processes Nicolas flagged as missing in the system.
 *
 * Usage:
 *   API_URL=http://importacao.grupounico.com IMPORT_TOKEN=<bearer> \
 *     node scripts/create-pending-processes.js
 *
 * The script is idempotent: the /from-pre-cons endpoint returns the existing
 * process if the code already exists (returns 200 with existed:true).
 */

const API_URL = process.env.API_URL || 'http://localhost:3000';
const TOKEN = process.env.IMPORT_TOKEN;

if (!TOKEN) {
  console.error('Missing IMPORT_TOKEN env. Get a bearer token via the login endpoint and re-run.');
  process.exit(1);
}

const PROCESSES = [
  { processCode: 'IM0732604NB', brand: 'imaginarium' },
  { processCode: 'IM0742605SZ', brand: 'imaginarium' },
  { processCode: 'PKT-0032-BD-SEA', brand: 'puket' },
];

async function createOne({ processCode, brand }) {
  const res = await fetch(`${API_URL}/api/processes/from-pre-cons`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ processCode, brand }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { processCode, status: 'error', http: res.status, body: json };
  }
  return { processCode, status: 'ok', http: res.status, body: json };
}

(async () => {
  const results = [];
  for (const p of PROCESSES) {
    try {
      const r = await createOne(p);
      results.push(r);
      console.log(
        `${r.status === 'ok' ? '✓' : '✗'} ${p.processCode} (${p.brand}) — HTTP ${r.http}`,
      );
      if (r.body?.data?.existed) {
        console.log(`  (already existed — id=${r.body.data.id ?? '?'})`);
      } else if (r.body?.data?.id) {
        console.log(`  Created process id=${r.body.data.id}`);
      }
    } catch (err) {
      console.error(`✗ ${p.processCode} — ${err.message}`);
      results.push({ processCode: p.processCode, status: 'error', message: err.message });
    }
  }
  const failed = results.filter((r) => r.status !== 'ok');
  if (failed.length > 0) {
    console.error(`\n${failed.length} processo(s) com falha.`);
    process.exit(2);
  }
})();
