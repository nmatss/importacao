/**
 * Import LI (Licenca de Importacao) tracking data from the "LIs" sheet
 * into the li_tracking table.
 *
 * Usage: node scripts/import-lis.js
 */

const XLSX = require('xlsx');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const FILE_PATH = '/mnt/c/Users/nic20/OneDrive/Área de Trabalho/1_Follow Up Processos de Importação.xlsx';

// ── Helpers ────────────────────────────────────────────────────────────

function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    if (val < 1) return null;
    const d = new Date((val - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (!cleaned) return null;
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

function parseNumeric(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function cleanString(val, maxLen) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || s === '-') return null;
  return maxLen ? s.substring(0, maxLen) : s;
}

function mapLiStatus(status) {
  if (!status) return 'pending';
  const s = String(status).toUpperCase().trim();
  if (s === 'DEFERIDA' || s.includes('DEFERID')) return 'deferred';
  if (s === 'PENDENTE') return 'pending';
  if (s === 'EM ANÁLISE' || s.includes('EM AN') || s.includes('ANÁLISE')) return 'submitted';
  if (s === 'SOLICITADA') return 'requested';
  if (s === 'INDEFERIDA') return 'cancelled';
  if (s === 'EXPIRADA' || s.includes('EXPIR')) return 'expired';
  if (s.includes('LI DEFERIDA')) return 'deferred';
  return 'pending';
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx);
    let value = trimmed.substring(eqIdx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  console.log(`Connecting to DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to database.');

  // ── Create enum and table if they don't exist ──
  // Column names must match Drizzle schema in schema.ts
  console.log('Ensuring li_status enum and li_tracking table exist...');

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE li_status AS ENUM ('pending', 'requested', 'submitted', 'deferred', 'expired', 'cancelled');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS li_tracking (
      id SERIAL PRIMARY KEY,
      process_id INTEGER REFERENCES import_processes(id),
      process_code VARCHAR(50) NOT NULL,
      orgao VARCHAR(100),
      ncm TEXT,
      item VARCHAR(255),
      description TEXT,
      supplier VARCHAR(500),
      requested_by_company_at DATE,
      submitted_to_fenicia_at DATE,
      deferred_at DATE,
      expected_deferral_at DATE,
      average_days INTEGER,
      valid_until DATE,
      lpco_number VARCHAR(100),
      etd_origem DATE,
      eta_armador DATE,
      status li_status DEFAULT 'pending' NOT NULL,
      item_status VARCHAR(100),
      observations TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await client.query('CREATE INDEX IF NOT EXISTS li_tracking_process_id_idx ON li_tracking(process_id);');
  await client.query('CREATE INDEX IF NOT EXISTS li_tracking_process_code_idx ON li_tracking(process_code);');
  await client.query('CREATE INDEX IF NOT EXISTS li_tracking_status_idx ON li_tracking(status);');

  console.log('Table and indexes ready.');

  // ── Read the LIs sheet ──
  console.log('Reading spreadsheet...');
  const wb = XLSX.readFile(FILE_PATH);

  const sheetName = 'LIs';
  const sheetIdx = wb.SheetNames.indexOf(sheetName);
  console.log(`Using sheet: "${sheetName}" (index ${sheetIdx})`);
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Skip header row, filter rows with process code
  const rows = data.filter((r, i) => i > 0 && r[0] && String(r[0]).trim());
  console.log(`Total rows with process code: ${rows.length}`);

  // ── Build process code -> id map ──
  const existing = await client.query('SELECT id, process_code FROM import_processes');
  const processMap = new Map();
  for (const row of existing.rows) {
    processMap.set(row.process_code, row.id);
  }
  console.log(`Existing processes in DB: ${processMap.size}`);

  // ── Check existing LI records to avoid duplicates ──
  const existingLis = await client.query('SELECT process_code, orgao, ncm FROM li_tracking');
  const liKeys = new Set();
  for (const row of existingLis.rows) {
    liKeys.add(`${row.process_code}|${row.orgao || ''}|${row.ncm || ''}`);
  }
  console.log(`Existing LI records: ${liKeys.size}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let noProcess = 0;

  for (const row of rows) {
    const processCode = cleanString(row[0], 50);
    if (!processCode) { skipped++; continue; }

    const orgao = cleanString(row[1], 100);
    const ncm = cleanString(row[2]);
    const requestedByCompanyAt = excelDateToISO(row[3]);
    const submittedToFeniciaAt = excelDateToISO(row[4]);
    const deferredAt = excelDateToISO(row[5]);
    const expectedDeferralAt = excelDateToISO(row[6]);
    const averageDays = parseNumeric(row[7]);
    const status = mapLiStatus(row[8]);
    const etdOrigem = excelDateToISO(row[9]);
    const etaArmador = excelDateToISO(row[10]);
    const observations = cleanString(row[11]);

    // Check for duplicates
    const liKey = `${processCode}|${orgao || ''}|${ncm || ''}`;
    if (liKeys.has(liKey)) {
      skipped++;
      continue;
    }

    // Try to find process_id
    const processId = processMap.get(processCode) || null;
    if (!processId) noProcess++;

    try {
      await client.query(`
        INSERT INTO li_tracking (
          process_id, process_code, orgao, ncm,
          requested_by_company_at, submitted_to_fenicia_at, deferred_at, expected_deferral_at,
          average_days, status, etd_origem, eta_armador,
          observations, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, NOW(), NOW()
        )
      `, [
        processId, processCode, orgao, ncm,
        requestedByCompanyAt, submittedToFeniciaAt, deferredAt, expectedDeferralAt,
        averageDays ? Math.round(averageDays) : null, status, etdOrigem, etaArmador,
        observations,
      ]);

      liKeys.add(liKey);
      inserted++;
      if (inserted % 100 === 0) {
        console.log(`  ...inserted ${inserted} LI records`);
      }
    } catch (err) {
      console.error(`  Error inserting LI for ${processCode} (${orgao}/${ncm}):`, err.message);
      errors++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped (duplicates), ${noProcess} without matching process, ${errors} errors`);

  // Summary
  const totalLis = await client.query('SELECT count(*) as total FROM li_tracking');
  console.log(`\nTotal LI records in DB: ${totalLis.rows[0].total}`);

  const statusDist = await client.query(`
    SELECT status, count(*) as cnt FROM li_tracking GROUP BY status ORDER BY cnt DESC
  `);
  console.log('\nLI status distribution:');
  statusDist.rows.forEach(r => console.log(`  ${r.cnt}: ${r.status}`));

  const orgaoDist = await client.query(`
    SELECT orgao, count(*) as cnt FROM li_tracking GROUP BY orgao ORDER BY cnt DESC
  `);
  console.log('\nLI orgao distribution:');
  orgaoDist.rows.forEach(r => console.log(`  ${r.cnt}: ${r.orgao}`));

  const withProcess = await client.query(
    'SELECT count(*) as total FROM li_tracking WHERE process_id IS NOT NULL'
  );
  console.log(`\nLI records linked to a process: ${withProcess.rows[0].total}`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
