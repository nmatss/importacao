/**
 * Import processes from Follow-Up spreadsheet into the database.
 * Reads the XLSX file and inserts into import_processes + follow_up_tracking tables.
 *
 * Usage: node scripts/import-follow-up.js [--all] [--active-only]
 *   --all: import all processes (default: active + last 50 encerrados)
 *   --active-only: only import non-encerrado processes
 */

const XLSX = require('xlsx');
const { Client } = require('pg');

const FILE_PATH = '/mnt/c/Users/nic20/OneDrive/Área de Trabalho/1_Follow Up Processos de Importação.xlsx';

// Column index mapping (from row 0 headers)
const COL = {
  processCode: 0,
  status: 1,
  urgency: 2,
  supplier: 3,
  purchase: 4,
  consolidation: 5,
  statusLi: 6,
  ncms: 7,
  productSummary: 8,
  inspection: 9,
  bl: 10,
  etdOrigin: 11,
  shipFinal: 12,
  origin: 13,
  portOfLoading: 14,
  portOfDischarge: 15,
  freightAgent: 16,
  invoiceValueUsd: 17,
  statusInvoiceValue: 18,
  freightUsd: 19,
  insuranceUsd: 20,
  shipowner: 21,
  customsValue: 22,
  containerType: 23,
  containerCount: 24,
  cbm: 25,
  statusCbm: 26,
  ship: 27,
  connections: 28,
  cashValue: 29,
  cashPaymentDate: 30,
  etdTransship: 31,
  omittedPort: 32,
  etaPrevisto: 33,
  transshipPort: 34,
  omissionDelay: 35,
  etaPrevistoMedio: 36,
  etaArmador: 37,
  etaFinal: 38,
  etaRealizado: 39,
  ttDays: 40,
  blOriginalAvailable: 41,
  exchangeData: 42,
  recinto: 43,
  voyageMain: 44,
  voyageConnection: 45,
  diNumber: 46,
  diDate: 47,
  diDollar: 48,
  channel: 49,
  clearance: 50,
  loading: 51,
  carrier: 52,
  carrierValue: 53,
  arrivalCD: 54,
  nfEntry: 55,
  demurrageAlert: 56,
  returnChargeType: 57,
  exemption: 58,
  paidValue: 59,
  observations: 60,
  etdPrior: 61,
  etaPrior: 62,
  departureDelay: 63,
  arrivalDelay: 64,
  ttBookingVsReal: 65,
  deliveryTime: 66,
  monthArrivalCD: 67,
  yearArrivalCD: 68,
  company: 69,
  totalDays: 70,
  docsReceivedDate: 71,
  preConference: 72,
  saveFolder: 73,
  checkNcm: 74,
  checkNcmBl: 75,
  checkFreightBl: 76,
  updateFollowUp: 77,
  buildConsolidated: 78,
  sendInvoice: 79,
  collectSignatures: 80,
  sendDocsCopy: 81,
  docsOk: 82,
  docCorrection: 83,
  errorCount: 84,
  errorType: 85,
  errorFile: 86,
  dispatcherRef: 87,
  shipper: 88,
};

function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (!cleaned) return null;
    // Try parsing various date formats
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

function excelDateToTimestamp(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    if (!cleaned) return null;
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString();
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
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  return maxLen ? s.substring(0, maxLen) : s;
}

function mapSheetStatus(sheetStatus) {
  const s = String(sheetStatus || '').toLowerCase().trim();
  if (s.includes('encerrado')) return 'completed';
  if (s.includes('aguardando entrada')) return 'documents_received';
  if (s.includes('aguardando embarque')) return 'draft';
  if (s.includes('trânsito') || s.includes('transito')) return 'validated';
  if (s.includes('li')) return 'li_pending';
  return 'draft';
}

function determineBrand(row) {
  const consolidation = String(row[COL.consolidation] || '').toLowerCase();
  const company = String(row[COL.company] || '').toLowerCase();
  const processCode = String(row[COL.processCode] || '').toUpperCase();

  if (processCode.startsWith('PK') || consolidation.includes('puket') || company.includes('puket')) {
    return 'puket';
  }
  return 'imaginarium';
}

async function main() {
  const args = process.argv.slice(2);
  const importAll = args.includes('--all');
  const activeOnly = args.includes('--active-only');

  console.log('Reading spreadsheet...');
  const wb = XLSX.readFile(FILE_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Filter rows with process codes
  let rows = data.filter((r, i) => i > 0 && r[0] && String(r[0]).trim());
  console.log(`Total rows with process code: ${rows.length}`);

  if (activeOnly) {
    rows = rows.filter(r => {
      const st = String(r[COL.status]).toLowerCase();
      return st.indexOf('encerrado') === -1;
    });
    console.log(`Active rows only: ${rows.length}`);
  } else if (!importAll) {
    // Import all active + last 100 encerrados
    const active = rows.filter(r => String(r[COL.status]).toLowerCase().indexOf('encerrado') === -1);
    const encerrados = rows.filter(r => String(r[COL.status]).toLowerCase().indexOf('encerrado') !== -1);
    const recentEncerrados = encerrados.slice(-100);
    rows = [...recentEncerrados, ...active];
    console.log(`Importing: ${active.length} active + ${recentEncerrados.length} recent encerrados = ${rows.length}`);
  }

  // Connect to production DB via SSH tunnel or direct
  const dbUrl = process.env.DATABASE_URL || 'postgresql://importacao:importacao@192.168.168.124:5450/importacao';
  console.log(`Connecting to DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to database.');

  // Get existing process codes to avoid duplicates
  const existing = await client.query('SELECT process_code FROM import_processes');
  const existingCodes = new Set(existing.rows.map(r => r.process_code));
  console.log(`Existing processes in DB: ${existingCodes.size}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const processCode = cleanString(row[COL.processCode], 50);
    if (!processCode) { skipped++; continue; }

    if (existingCodes.has(processCode)) {
      skipped++;
      continue;
    }

    const brand = determineBrand(row);
    const status = mapSheetStatus(row[COL.status]);
    const invoiceValue = parseNumeric(row[COL.invoiceValueUsd]);
    const freight = parseNumeric(row[COL.freightUsd]);
    const cbm = parseNumeric(row[COL.cbm]);
    const containerCount = parseNumeric(row[COL.containerCount]);
    const etd = excelDateToISO(row[COL.etdOrigin]);
    const eta = excelDateToISO(row[COL.etaFinal]) || excelDateToISO(row[COL.etaPrevisto]);
    const etaRealizado = excelDateToISO(row[COL.etaRealizado]);
    const containerType = cleanString(row[COL.containerType], 50);
    const portOfLoading = cleanString(row[COL.portOfLoading], 100);
    const portOfDischarge = cleanString(row[COL.portOfDischarge], 100);
    const exporterName = cleanString(row[COL.supplier], 255);
    const consolidation = cleanString(row[COL.consolidation], 255);
    const shipper = cleanString(row[COL.shipper], 255);
    const observations = cleanString(row[COL.observations]);
    const urgency = cleanString(row[COL.urgency], 255);
    const blNumber = cleanString(row[COL.bl], 255);
    const ship = cleanString(row[COL.shipFinal] || row[COL.ship], 255);
    const origin = cleanString(row[COL.origin], 100);
    const freightAgent = cleanString(row[COL.freightAgent], 255);
    const shipowner = cleanString(row[COL.shipowner], 255);
    const diNumber = cleanString(row[COL.diNumber], 100);
    const channel = cleanString(row[COL.channel], 50);
    const docsReceivedDate = excelDateToTimestamp(row[COL.docsReceivedDate]);
    const cashPaymentDate = excelDateToISO(row[COL.cashPaymentDate]);
    const cashValue = parseNumeric(row[COL.cashValue]);
    const insurance = parseNumeric(row[COL.insuranceUsd]);
    const customsValue = parseNumeric(row[COL.customsValue]);
    const errorCount = parseNumeric(row[COL.errorCount]);
    const correctionStatus = cleanString(row[COL.docCorrection], 30);

    // Build notes from various text fields
    const noteParts = [];
    if (urgency) noteParts.push(`Urgencia: ${urgency}`);
    if (observations) noteParts.push(`Obs: ${observations}`);
    if (blNumber) noteParts.push(`BL: ${blNumber}`);
    if (ship) noteParts.push(`Navio: ${ship}`);
    if (freightAgent) noteParts.push(`Agente: ${freightAgent}`);
    if (shipowner) noteParts.push(`Armador: ${shipowner}`);
    if (diNumber) noteParts.push(`DI: ${diNumber}`);
    if (channel) noteParts.push(`Canal: ${channel}`);
    if (origin) noteParts.push(`Origem: ${origin}`);
    const notes = noteParts.length > 0 ? noteParts.join(' | ') : null;

    // Build aiExtractedData with extra spreadsheet fields
    const extraData = {};
    if (blNumber) extraData.blNumber = blNumber;
    if (ship) extraData.vessel = ship;
    if (shipowner) extraData.shipowner = shipowner;
    if (freightAgent) extraData.freightAgent = freightAgent;
    if (origin) extraData.origin = origin;
    if (containerCount) extraData.containerCount = containerCount;
    if (consolidation) extraData.consolidation = consolidation;
    if (shipper) extraData.shipper = shipper;
    if (diNumber) extraData.diNumber = diNumber;
    if (channel) extraData.channel = channel;
    if (insurance) extraData.insurance = insurance;
    if (customsValue) extraData.customsValue = customsValue;
    if (cashValue) extraData.cashValue = cashValue;
    if (cashPaymentDate) extraData.cashPaymentDate = cashPaymentDate;
    if (etaRealizado) extraData.etaRealizado = etaRealizado;
    if (errorCount) extraData.docErrorCount = errorCount;
    if (cleanString(row[COL.statusLi])) extraData.statusLi = cleanString(row[COL.statusLi], 50);
    if (cleanString(row[COL.ncms])) extraData.ncms = cleanString(row[COL.ncms]);
    if (cleanString(row[COL.productSummary])) extraData.productSummary = cleanString(row[COL.productSummary]);
    if (cleanString(row[COL.inspection])) extraData.inspection = cleanString(row[COL.inspection], 100);
    if (cleanString(row[COL.recinto])) extraData.recinto = cleanString(row[COL.recinto], 100);
    extraData.sheetStatus = cleanString(row[COL.status], 100);
    extraData.importedFromSheet = true;
    extraData.importedAt = new Date().toISOString();

    try {
      const result = await client.query(`
        INSERT INTO import_processes (
          process_code, brand, status, incoterm,
          port_of_loading, port_of_discharge,
          etd, eta,
          total_fob_value, freight_value, total_cbm,
          exporter_name, container_type,
          correction_status,
          ai_extracted_data, notes,
          created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'FOB',
          $4, $5,
          $6, $7,
          $8, $9, $10,
          $11, $12,
          $13,
          $14, $15,
          1, NOW(), NOW()
        ) RETURNING id
      `, [
        processCode, brand, status,
        portOfLoading, portOfDischarge,
        etd, eta,
        invoiceValue, freight, cbm,
        exporterName, containerType,
        correctionStatus,
        JSON.stringify(extraData), notes,
      ]);

      const processId = result.rows[0].id;

      // Create follow_up_tracking
      await client.query(`
        INSERT INTO follow_up_tracking (
          process_id, documents_received_at,
          overall_progress, notes,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      `, [
        processId,
        docsReceivedDate,
        status === 'completed' ? 100 : status === 'validated' ? 60 : status === 'documents_received' ? 30 : 10,
        urgency || null,
      ]);

      inserted++;
      if (inserted % 50 === 0) {
        console.log(`  ...inserted ${inserted} processes`);
      }
    } catch (err) {
      console.error(`  Error inserting ${processCode}:`, err.message);
      errors++;
    }
  }

  console.log(`\nDone: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);

  // Print summary
  const counts = await client.query(`
    SELECT status, count(*) as cnt
    FROM import_processes
    GROUP BY status
    ORDER BY cnt DESC
  `);
  console.log('\nProcess status distribution:');
  counts.rows.forEach(r => console.log(`  ${r.cnt}: ${r.status}`));

  const total = await client.query('SELECT count(*) as total FROM import_processes');
  console.log(`\nTotal processes in DB: ${total.rows[0].total}`);

  const fupTotal = await client.query('SELECT count(*) as total FROM follow_up_tracking');
  console.log(`Total follow-up entries: ${fupTotal.rows[0].total}`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
