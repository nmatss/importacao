/**
 * Update existing processes with extra data from the "Processos" sheet.
 * Merges new fields into ai_extracted_data JSONB without overwriting existing data.
 *
 * Usage: node scripts/update-processes-extra-data.js
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
  if (!s) return null;
  return maxLen ? s.substring(0, maxLen) : s;
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
    // Strip surrounding quotes
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

  console.log('Reading spreadsheet...');
  const wb = XLSX.readFile(FILE_PATH);

  // Sheet index 4, name "Processos"
  const sheetName = wb.SheetNames[4];
  console.log(`Using sheet: "${sheetName}" (index 4)`);
  const ws = wb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Skip header row
  const rows = data.filter((r, i) => i > 0 && r[0] && String(r[0]).trim());
  console.log(`Total rows with process code: ${rows.length}`);

  // Connect to DB
  const dbUrl = process.env.DATABASE_URL;
  console.log(`Connecting to DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to database.');

  // Get all existing processes with their current ai_extracted_data
  const existing = await client.query(
    'SELECT id, process_code, ai_extracted_data FROM import_processes'
  );
  const processMap = new Map();
  for (const row of existing.rows) {
    processMap.set(row.process_code, {
      id: row.id,
      aiExtractedData: row.ai_extracted_data || {},
    });
  }
  console.log(`Existing processes in DB: ${processMap.size}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const processCode = cleanString(row[0], 50);
    if (!processCode) { skipped++; continue; }

    const proc = processMap.get(processCode);
    if (!proc) {
      skipped++;
      continue;
    }

    // Build extra data from specified columns
    const extraData = {};

    // ── General fields ──
    const seguro = parseNumeric(row[20]);
    if (seguro !== null) extraData.seguro = seguro;

    const alertaSeguro = cleanString(row[21]);
    if (alertaSeguro) extraData.alertaSeguro = alertaSeguro;

    const armador = cleanString(row[22], 255);
    if (armador) extraData.armador = armador;

    const valorAduaneiro = parseNumeric(row[23]);
    if (valorAduaneiro !== null) extraData.valorAduaneiro = valorAduaneiro;

    const noCtnr = parseNumeric(row[25]);
    if (noCtnr !== null) extraData.noCtnr = noCtnr;

    const valorNumerario = parseNumeric(row[29]);
    if (valorNumerario !== null) extraData.valorNumerario = valorNumerario;

    const dataPgtoNumerario = excelDateToISO(row[30]);
    if (dataPgtoNumerario) extraData.dataPgtoNumerario = dataPgtoNumerario;

    const etdTransbordo = excelDateToISO(row[32]);
    if (etdTransbordo) extraData.etdTransbordo = etdTransbordo;

    const etaPrevisto = excelDateToISO(row[34]);
    if (etaPrevisto) extraData.etaPrevisto = etaPrevisto;

    const portoTransbordo = cleanString(row[35], 255);
    if (portoTransbordo) extraData.portoTransbordo = portoTransbordo;

    const etaPrevistoMedio = excelDateToISO(row[37]);
    if (etaPrevistoMedio) extraData.etaPrevistoMedio = etaPrevistoMedio;

    const etaArmador = excelDateToISO(row[38]);
    if (etaArmador) extraData.etaArmador = etaArmador;

    const etaFinal = excelDateToISO(row[39]);
    if (etaFinal) extraData.etaFinal = etaFinal;

    const etaRealizado = excelDateToISO(row[40]);
    if (etaRealizado) extraData.etaRealizado = etaRealizado;

    const ttDias = parseNumeric(row[41]);
    if (ttDias !== null) extraData.ttDias = ttDias;

    const blOriginalDisponivel = cleanString(row[42]);
    if (blOriginalDisponivel) extraData.blOriginalDisponivel = blOriginalDisponivel;

    const dadosCambio = cleanString(row[43]);
    if (dadosCambio) extraData.dadosCambio = dadosCambio;

    const recinto = cleanString(row[44], 255);
    if (recinto) extraData.recinto = recinto;

    const nroViagemNavioPrincipal = cleanString(row[45], 100);
    if (nroViagemNavioPrincipal) extraData.nroViagemNavioPrincipal = nroViagemNavioPrincipal;

    const nroViagemConexao = cleanString(row[46], 100);
    if (nroViagemConexao) extraData.nroViagemConexao = nroViagemConexao;

    const numeroDI = cleanString(row[47], 100);
    if (numeroDI) extraData.numeroDI = numeroDI;

    const dataRegistroDI = excelDateToISO(row[48]);
    if (dataRegistroDI) extraData.dataRegistroDI = dataRegistroDI;

    const dolarRegistro = parseNumeric(row[49]);
    if (dolarRegistro !== null) extraData.dolarRegistro = dolarRegistro;

    const canal = cleanString(row[50], 50);
    if (canal) extraData.canal = canal;

    const desembaraco = excelDateToISO(row[51]);
    if (desembaraco) extraData.desembaraco = desembaraco;

    const carregamento = excelDateToISO(row[52]);
    if (carregamento) extraData.carregamento = carregamento;

    const transportadora = cleanString(row[53], 255);
    if (transportadora) extraData.transportadora = transportadora;

    const valorTransportadora = parseNumeric(row[54]);
    if (valorTransportadora !== null) extraData.valorTransportadora = valorTransportadora;

    const chegadaCD = excelDateToISO(row[55]);
    if (chegadaCD) extraData.chegadaCD = chegadaCD;

    const entradaNF = excelDateToISO(row[56]);
    if (entradaNF) extraData.entradaNF = entradaNF;

    const fechamentoFenicia = excelDateToISO(row[57]);
    if (fechamentoFenicia) extraData.fechamentoFenicia = fechamentoFenicia;

    const cte = cleanString(row[58]);
    if (cte) extraData.cte = cte;

    const freeTime = cleanString(row[59]);
    if (freeTime) extraData.freeTime = freeTime;

    const alertaDemurrage = cleanString(row[60]);
    if (alertaDemurrage) extraData.alertaDemurrage = alertaDemurrage;

    const observacoes = cleanString(row[65]);
    if (observacoes) extraData.observacoes = observacoes;

    const correcaoDocumental = cleanString(row[89], 100);
    if (correcaoDocumental) extraData.correcaoDocumental = correcaoDocumental;

    const quantidadeErros = parseNumeric(row[90]);
    if (quantidadeErros !== null) extraData.quantidadeErros = quantidadeErros;

    const referenciaDespachante = cleanString(row[93], 255);
    if (referenciaDespachante) extraData.referenciaDespachante = referenciaDespachante;

    const shipper = cleanString(row[94], 255);
    if (shipper) extraData.shipper = shipper;

    const percentualNumerario = parseNumeric(row[110]);
    if (percentualNumerario !== null) extraData.percentualNumerario = percentualNumerario;

    const extraFee = parseNumeric(row[111]);
    if (extraFee !== null) extraData.extraFee = extraFee;

    const solicitanteNumerario = cleanString(row[112], 255);
    if (solicitanteNumerario) extraData.solicitanteNumerario = solicitanteNumerario;

    // ── Checklist fields ──
    const checklist = {};

    const prazoRecebimentoDocs = excelDateToISO(row[76]);
    if (prazoRecebimentoDocs) checklist.prazoRecebimentoDocs = prazoRecebimentoDocs;

    const dataRecebimentoDocs = excelDateToISO(row[77]);
    if (dataRecebimentoDocs) checklist.dataRecebimentoDocs = dataRecebimentoDocs;

    const preConferencia = cleanString(row[78]);
    if (preConferencia) checklist.preConferencia = preConferencia;

    const salvarNaPasta = cleanString(row[79]);
    if (salvarNaPasta) checklist.salvarNaPasta = salvarNaPasta;

    const conferirNCM = cleanString(row[80]);
    if (conferirNCM) checklist.conferirNCM = conferirNCM;

    const conferirNCMnoBL = cleanString(row[81]);
    if (conferirNCMnoBL) checklist.conferirNCMnoBL = conferirNCMnoBL;

    const conferirFreteBL = cleanString(row[82]);
    if (conferirFreteBL) checklist.conferirFreteBL = conferirFreteBL;

    const montarEspelho = cleanString(row[83]);
    if (montarEspelho) checklist.montarEspelho = montarEspelho;

    const enviarInvoiceFenicia = cleanString(row[84]);
    if (enviarInvoiceFenicia) checklist.enviarInvoiceFenicia = enviarInvoiceFenicia;

    const coletarAssinaturas = cleanString(row[85]);
    if (coletarAssinaturas) checklist.coletarAssinaturas = coletarAssinaturas;

    const enviarDocsAssinados = cleanString(row[86]);
    if (enviarDocsAssinados) checklist.enviarDocsAssinados = enviarDocsAssinados;

    const atualizarFollowUp = cleanString(row[87]);
    if (atualizarFollowUp) checklist.atualizarFollowUp = atualizarFollowUp;

    const rascunhoDI = cleanString(row[88]);
    if (rascunhoDI) checklist.rascunhoDI = rascunhoDI;

    if (Object.keys(checklist).length > 0) {
      extraData.checklist = checklist;
    }

    // ── Armazenagem fields ──
    const armazenagem = {};

    const armazenagemPortonave1 = excelDateToISO(row[95]);
    if (armazenagemPortonave1) armazenagem.portonave1 = armazenagemPortonave1;

    const armazenagemPortonave2 = excelDateToISO(row[96]);
    if (armazenagemPortonave2) armazenagem.portonave2 = armazenagemPortonave2;

    const armazenagemAPM1 = excelDateToISO(row[97]);
    if (armazenagemAPM1) armazenagem.apm1 = armazenagemAPM1;

    const armazenagemAPM2 = excelDateToISO(row[98]);
    if (armazenagemAPM2) armazenagem.apm2 = armazenagemAPM2;

    const armazenagemItapoa1 = excelDateToISO(row[99]);
    if (armazenagemItapoa1) armazenagem.itapoa1 = armazenagemItapoa1;

    const armazenagemItapoa2 = excelDateToISO(row[100]);
    if (armazenagemItapoa2) armazenagem.itapoa2 = armazenagemItapoa2;

    const custoArmazenagemPortonave = parseNumeric(row[101]);
    if (custoArmazenagemPortonave !== null) armazenagem.custoPortonave = custoArmazenagemPortonave;

    const custoArmazenagemAPM = parseNumeric(row[102]);
    if (custoArmazenagemAPM !== null) armazenagem.custoAPM = custoArmazenagemAPM;

    const custoArmazenagemItapoa = parseNumeric(row[103]);
    if (custoArmazenagemItapoa !== null) armazenagem.custoItapoa = custoArmazenagemItapoa;

    const custoArmazenagemLocalfrio = parseNumeric(row[104]);
    if (custoArmazenagemLocalfrio !== null) armazenagem.custoLocalfrio = custoArmazenagemLocalfrio;

    if (Object.keys(armazenagem).length > 0) {
      extraData.armazenagem = armazenagem;
    }

    // Skip if no new data to add
    if (Object.keys(extraData).length === 0) {
      skipped++;
      continue;
    }

    // Merge: existing data takes priority (don't overwrite), new data fills gaps
    const currentData = proc.aiExtractedData || {};
    const mergedData = { ...extraData, ...currentData };

    // For nested objects (checklist, armazenagem), merge at that level too
    if (extraData.checklist && currentData.checklist) {
      mergedData.checklist = { ...extraData.checklist, ...currentData.checklist };
    }
    if (extraData.armazenagem && currentData.armazenagem) {
      mergedData.armazenagem = { ...extraData.armazenagem, ...currentData.armazenagem };
    }

    mergedData.extraDataUpdatedAt = new Date().toISOString();

    try {
      await client.query(
        `UPDATE import_processes
         SET ai_extracted_data = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(mergedData), proc.id]
      );
      updated++;
      if (updated % 50 === 0) {
        console.log(`  ...updated ${updated} processes`);
      }
    } catch (err) {
      console.error(`  Error updating ${processCode} (id=${proc.id}):`, err.message);
      errors++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${errors} errors`);

  // Summary
  const total = await client.query('SELECT count(*) as total FROM import_processes');
  console.log(`Total processes in DB: ${total.rows[0].total}`);

  const withExtra = await client.query(
    `SELECT count(*) as total FROM import_processes
     WHERE ai_extracted_data->>'extraDataUpdatedAt' IS NOT NULL`
  );
  console.log(`Processes with extra data: ${withExtra.rows[0].total}`);

  await client.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
