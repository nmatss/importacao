/**
 * Import processes from Follow-Up spreadsheet into the database.
 * Reads the XLSX file and inserts/updates import_processes + follow_up_tracking + document_corrections.
 *
 * Usage: node scripts/import-follow-up.js [--all] [--active-only] [--update]
 *   --all: import all processes (default: active + last 100 encerrados)
 *   --active-only: only import non-encerrado processes
 *   --update: update existing processes instead of skipping duplicates
 */

const XLSX = require('xlsx');
const { Client } = require('pg');

const FILE_PATH = process.env.XLSX_PATH || '1_Follow Up Processos de Importação.xlsx';

// Column index mapping (0-based, from row 0 headers of "Processos" sheet)
const COL = {
  processCode: 0, // "Processos"
  status: 1, // "Status"
  urgency: 2, // "Urgências / Prioridades"
  supplier: 3, // "Fornecedor/ Supplier"
  purchase: 4, // "Compra"
  consolidation: 5, // "Consolidação (PKT&IMG)"
  statusLi: 6, // "Status LI // LPCO"
  ncms: 7, // "NCM´s"
  productSummary: 8, // "Resumo Itens"
  inspection: 9, // "Inspeção"
  bl: 10, // "B/L"
  etdOrigin: 11, // "ETD ORIGEM*"
  shipFinal: 12, // "Navio Final"
  origin: 13, // "Origem"
  portOfLoading: 14, // "Porto de Embarque"
  portOfDischarge: 15, // "Porto de Destino"
  freightAgent: 16, // "Agente de Carga"
  invoiceValueUsd: 17, // "Valor Invoice (USD)"
  statusInvoiceValue: 18, // "Status Valor Invoice"
  freightUsd: 19, // "Frete (USD)"
  insuranceUsd: 20, // "Seguro (USD)"
  alertInsurance: 21, // "Alerta Seguro"
  shipowner: 22, // "ARMADOR"
  customsValue: 23, // "Valor Aduaneiro"
  containerType: 24, // "Container"
  containerCount: 25, // "No Ctnr"
  cbm: 26, // "CBM"
  statusCbm: 27, // "Status Cubagem"
  ship: 28, // "Navio"
  connections: 29, // "Conexões"
  cashValue: 30, // "Valor Numerário"
  cashPaymentDate: 31, // "Data Pgto Numerário"
  etdTransship: 32, // "ETD TRANSB."
  omittedPort: 33, // "Porto Omitido"
  etaPrevisto: 34, // "ETA Previsto"
  transshipPort: 35, // "Porto de Transbordo/Fim de trânsito"
  omissionDelay: 36, // "Atraso Omissão"
  etaPrevistoMedio: 37, // "ETA Previsto Médio"
  etaArmador: 38, // "ETA Armador*"
  etaFinal: 39, // "ETA Final*"
  etaRealizado: 40, // "ETA Realizado"
  ttDays: 41, // "TT dias"
  blOriginalAvailable: 42, // "BL Original disponível para retirada"
  exchangeData: 43, // "Dados Câmbio"
  recinto: 44, // "Recinto"
  voyageMain: 45, // "Nro Viagem - Navio Principal"
  voyageConnection: 46, // "Nro Viagem - Conexão"
  diNumber: 47, // "Número de Registro DI / DUIMP"
  diDate: 48, // "Data Registro DI / DUIMP"
  diDollar: 49, // "Dólar de registro"
  channel: 50, // "Canal"
  clearance: 51, // "Desembaraço"
  loading: 52, // "Carregamento"
  carrier: 53, // "Transportadora"
  carrierValue: 54, // "Valor pago Transportadora"
  arrivalCD: 55, // "Chegada CD"
  nfEntry: 56, // "Entrada NF*"
  feniciaClose: 57, // "Fechamento Fenícia"
  cte: 58, // "CTE"
  freeTime: 59, // "Free Time"
  demurrageAlert: 60, // "Alerta Demurrage"
  returnChargeType: 61, // "Tipo de Cobrança Devolução Vazio"
  exemption: 62, // "Tipo de Isenção"
  paidValue: 63, // "Pago R$"
  exemptValue: 64, // "Isento R$"
  observations: 65, // "OBSERVAÇÕES"
  etdPrior: 66, // "ETD Prévio - 1º Booking"
  etaPrior: 67, // "ETA Prévio - 1º Booking"
  departureDelay: 68, // "Atraso Embarque"
  arrivalDelay: 69, // "Atraso Chegada"
  ttBookingVsReal: 70, // "TT 1º booking x chegada real"
  deliveryTime: 71, // "Tempo para entrega no CD"
  monthArrivalCD: 72, // "mês entrada CD"
  yearArrivalCD: 73, // "Ano entrada CD"
  company: 74, // "Empresa"
  totalDays: 75, // "Dias corridos total"
  docReceiptDeadline: 76, // "Prazo de recebimento dos documentos"
  docsReceivedDate: 77, // "Data recebimento documentos*"
  preConference: 78, // "Pré conferência"
  saveFolder: 79, // "Salvar na pasta"
  checkNcmDesc: 80, // "Conferir NCM's, descrições e atributos (PKT)"
  checkNcmBl: 81, // "Conferir se todas as NCM estão no BL"
  checkFreightBl: 82, // "Conferir valor do frete no BL"
  buildConsolidated: 83, // "Montar o consolidado e espelho do processo"
  sendInvoice: 84, // "Enviar Invoice Fenicia*"
  collectSignatures: 85, // "Coletar Assinaturas nos Documentos"
  sendDocsCopy: 86, // "Enviar por e-mail cópia dos docs assinados..."
  updateFollowUp: 87, // "Atualizar Follow-up"
  diDraft: 88, // "Rascunho da DI"
  docCorrection: 89, // "CORREÇÃO DOCUMENTAL EDUARDA / FENÍCIA"
  errorCount: 90, // "QUANTIDADE ERROS"
  errorType: 91, // "TIPO"
  errorFile: 92, // "ARQUIVO"
  dispatcherRef: 93, // "Referência Despachante"
  shipper: 94, // "SHIPPER"
  numerarioPct: 110, // "% numerário"
};

function excelDateToISO(val) {
  if (!val) return null;
  if (typeof val === 'number') {
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
  const s = String(val)
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseInt2(val) {
  const n = parseNumeric(val);
  if (n === null) return null;
  return Math.round(n);
}

function cleanString(val, maxLen) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  return maxLen ? s.substring(0, maxLen) : s;
}

/**
 * Check if a checklist cell is "done" — common patterns: "OK", "ok", date, checkmark, "SIM"
 * Returns a timestamp if done, null otherwise.
 */
function checklistToTimestamp(val) {
  if (!val) return null;
  // If it's a date number, use it directly
  if (typeof val === 'number' && val > 40000 && val < 60000) {
    return excelDateToTimestamp(val);
  }
  const s = String(val).trim().toUpperCase();
  if (!s || s === '0' || s === 'NÃO' || s === 'NAO' || s === 'N' || s === '-') return null;
  // "OK", "SIM", "X", checkmarks, or any non-empty truthy value -> use current timestamp
  if (s === 'OK' || s === 'SIM' || s === 'S' || s === 'X' || s === '✓' || s === '✔' || s === '1') {
    return new Date().toISOString();
  }
  // Try as date
  const ts = excelDateToTimestamp(val);
  if (ts) return ts;
  // Any other non-empty value → treat as done
  if (s.length > 0) return new Date().toISOString();
  return null;
}

function mapSheetStatus(sheetStatus) {
  const s = String(sheetStatus || '')
    .toLowerCase()
    .trim();
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

  if (
    processCode.startsWith('PK') ||
    consolidation.includes('puket') ||
    company.includes('puket')
  ) {
    return 'puket';
  }
  return 'imaginarium';
}

async function main() {
  const args = process.argv.slice(2);
  const importAll = args.includes('--all');
  const activeOnly = args.includes('--active-only');
  const doUpdate = args.includes('--update');

  console.log('Reading spreadsheet...');
  console.log(`File: ${FILE_PATH}`);
  const wb = XLSX.readFile(FILE_PATH);
  const ws = wb.Sheets['Processos'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Filter rows with process codes
  let rows = data.filter((r, i) => i > 0 && r[0] && String(r[0]).trim());
  console.log(`Total rows with process code: ${rows.length}`);

  if (activeOnly) {
    rows = rows.filter((r) => {
      const st = String(r[COL.status]).toLowerCase();
      return st.indexOf('encerrado') === -1;
    });
    console.log(`Active rows only: ${rows.length}`);
  } else if (!importAll) {
    // Import all active + last 100 encerrados
    const active = rows.filter(
      (r) => String(r[COL.status]).toLowerCase().indexOf('encerrado') === -1,
    );
    const encerrados = rows.filter(
      (r) => String(r[COL.status]).toLowerCase().indexOf('encerrado') !== -1,
    );
    const recentEncerrados = encerrados.slice(-100);
    rows = [...recentEncerrados, ...active];
    console.log(
      `Importing: ${active.length} active + ${recentEncerrados.length} recent encerrados = ${rows.length}`,
    );
  }

  // Connect to DB
  const dbUrl =
    process.env.DATABASE_URL || 'postgresql://importacao:importacao123@localhost:5432/importacao';
  console.log(`Connecting to DB: ${dbUrl.replace(/:[^:@]+@/, ':***@')}...`);

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  console.log('Connected to database.');

  // Get existing process codes with their IDs
  const existing = await client.query('SELECT id, process_code FROM import_processes');
  const existingMap = new Map(existing.rows.map((r) => [r.process_code, r.id]));
  console.log(`Existing processes in DB: ${existingMap.size}`);
  if (doUpdate) console.log('--update flag: will update existing processes');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let correctionsCreated = 0;

  for (const row of rows) {
    const processCode = cleanString(row[COL.processCode], 50);
    if (!processCode) {
      skipped++;
      continue;
    }

    const existingId = existingMap.get(processCode);
    if (existingId && !doUpdate) {
      skipped++;
      continue;
    }

    const brand = determineBrand(row);
    const status = mapSheetStatus(row[COL.status]);
    const invoiceValue = parseNumeric(row[COL.invoiceValueUsd]);
    const freight = parseNumeric(row[COL.freightUsd]);
    const cbm = parseNumeric(row[COL.cbm]);
    const etd = excelDateToISO(row[COL.etdOrigin]);
    const eta = excelDateToISO(row[COL.etaFinal]) || excelDateToISO(row[COL.etaPrevisto]);
    const portOfLoading = cleanString(row[COL.portOfLoading], 100);
    const portOfDischarge = cleanString(row[COL.portOfDischarge], 100);
    const exporterName = cleanString(row[COL.supplier], 255);
    const shipper = cleanString(row[COL.shipper], 255);
    const observations = cleanString(row[COL.observations]);
    const urgency = cleanString(row[COL.urgency], 255);
    const correctionStatus = cleanString(row[COL.docCorrection], 30);
    const docsReceivedDate = excelDateToTimestamp(row[COL.docsReceivedDate]);

    // New 19 columns
    const purchaseRef = cleanString(row[COL.purchase], 100);
    const vesselName = cleanString(row[COL.shipFinal] || row[COL.ship], 255);
    const blNumber = cleanString(row[COL.bl], 100);
    const shippingLine = cleanString(row[COL.shipowner], 255);
    const insuranceValue = parseNumeric(row[COL.insuranceUsd]);
    const consolidationRef = cleanString(row[COL.consolidation], 255);
    const etaCarrier = excelDateToISO(row[COL.etaArmador]);
    const etaActual = excelDateToISO(row[COL.etaRealizado]);
    const containerCount = parseInt2(row[COL.containerCount]);
    const freightAgent = cleanString(row[COL.freightAgent], 255);
    const originCity = cleanString(row[COL.origin], 100);
    const inspectionType = cleanString(row[COL.inspection], 50);
    const diNumber = cleanString(row[COL.diNumber], 100);
    const customsChannel = cleanString(row[COL.channel], 20);
    const customsClearanceAt = excelDateToTimestamp(row[COL.clearance]);
    const cdArrivalAt = excelDateToTimestamp(row[COL.arrivalCD]);
    const freeTimeDays = parseInt2(row[COL.freeTime]);
    const numerarioValue = parseNumeric(row[COL.cashValue]);
    const numerarioPct = parseNumeric(row[COL.numerarioPct]);

    // Build notes from various text fields
    const noteParts = [];
    if (urgency) noteParts.push(`Urgencia: ${urgency}`);
    if (observations) noteParts.push(`Obs: ${observations}`);
    const notes = noteParts.length > 0 ? noteParts.join(' | ') : null;

    // Build aiExtractedData with extra spreadsheet fields not in dedicated columns
    const extraData = {};
    if (shipper) extraData.shipper = shipper;
    if (parseNumeric(row[COL.customsValue]))
      extraData.customsValue = parseNumeric(row[COL.customsValue]);
    if (excelDateToISO(row[COL.cashPaymentDate]))
      extraData.cashPaymentDate = excelDateToISO(row[COL.cashPaymentDate]);
    if (cleanString(row[COL.statusLi])) extraData.statusLi = cleanString(row[COL.statusLi], 50);
    if (cleanString(row[COL.ncms])) extraData.ncms = cleanString(row[COL.ncms]);
    if (cleanString(row[COL.productSummary]))
      extraData.productSummary = cleanString(row[COL.productSummary]);
    if (cleanString(row[COL.recinto])) extraData.recinto = cleanString(row[COL.recinto], 100);
    if (cleanString(row[COL.dispatcherRef]))
      extraData.dispatcherRef = cleanString(row[COL.dispatcherRef], 100);
    if (cleanString(row[COL.connections]))
      extraData.connections = cleanString(row[COL.connections]);
    if (cleanString(row[COL.transshipPort]))
      extraData.transshipPort = cleanString(row[COL.transshipPort]);
    if (cleanString(row[COL.voyageMain])) extraData.voyageMain = cleanString(row[COL.voyageMain]);
    if (cleanString(row[COL.voyageConnection]))
      extraData.voyageConnection = cleanString(row[COL.voyageConnection]);
    if (parseNumeric(row[COL.diDollar])) extraData.diDollar = parseNumeric(row[COL.diDollar]);
    if (excelDateToISO(row[COL.diDate])) extraData.diDate = excelDateToISO(row[COL.diDate]);
    extraData.sheetStatus = cleanString(row[COL.status], 100);
    extraData.importedFromSheet = true;
    extraData.importedAt = new Date().toISOString();

    // Checklist timestamps for follow_up_tracking
    const savedToFolderAt = checklistToTimestamp(row[COL.saveFolder]);
    const ncmBlCheckedAt = checklistToTimestamp(row[COL.checkNcmBl]);
    const freightBlCheckedAt = checklistToTimestamp(row[COL.checkFreightBl]);
    const espelhoBuiltAt = checklistToTimestamp(row[COL.buildConsolidated]);
    const invoiceSentFeniciaAt = checklistToTimestamp(row[COL.sendInvoice]);
    const signaturesCollectedAt = checklistToTimestamp(row[COL.collectSignatures]);
    const signedDocsSentAt = checklistToTimestamp(row[COL.sendDocsCopy]);
    const diDraftAt = checklistToTimestamp(row[COL.diDraft]);

    // Correction data
    const correctionNeeded = String(row[COL.docCorrection] || '')
      .toUpperCase()
      .includes('SIM');
    const errorCount = parseInt2(row[COL.errorCount]);
    const errorTypeRaw = cleanString(row[COL.errorType]);
    const errorFileRaw = cleanString(row[COL.errorFile]);

    try {
      let processId;

      if (existingId) {
        // UPDATE existing process
        await client.query(
          `
          UPDATE import_processes SET
            brand = $2, status = $3,
            port_of_loading = $4, port_of_discharge = $5,
            etd = $6, eta = $7,
            total_fob_value = $8, freight_value = $9, total_cbm = $10,
            exporter_name = $11,
            correction_status = $12,
            ai_extracted_data = $13, notes = $14,
            purchase_ref = $15, vessel_name = $16, bl_number = $17,
            shipping_line = $18, insurance_value = $19, consolidation_ref = $20,
            eta_carrier = $21, eta_actual = $22, container_count = $23,
            freight_agent = $24, origin_city = $25, inspection_type = $26,
            di_number = $27, customs_channel = $28, customs_clearance_at = $29,
            cd_arrival_at = $30, free_time_days = $31,
            numerario_value = $32, numerario_pct = $33,
            updated_at = NOW()
          WHERE id = $1
        `,
          [
            existingId,
            brand,
            status,
            portOfLoading,
            portOfDischarge,
            etd,
            eta,
            invoiceValue,
            freight,
            cbm,
            exporterName,
            correctionStatus,
            JSON.stringify(extraData),
            notes,
            purchaseRef,
            vesselName,
            blNumber,
            shippingLine,
            insuranceValue,
            consolidationRef,
            etaCarrier,
            etaActual,
            containerCount,
            freightAgent,
            originCity,
            inspectionType,
            diNumber,
            customsChannel,
            customsClearanceAt,
            cdArrivalAt,
            freeTimeDays,
            numerarioValue,
            numerarioPct,
          ],
        );
        processId = existingId;

        // Update follow_up_tracking
        await client.query(
          `
          UPDATE follow_up_tracking SET
            documents_received_at = COALESCE($2, documents_received_at),
            overall_progress = $3,
            notes = COALESCE($4, notes),
            saved_to_folder_at = COALESCE($5, saved_to_folder_at),
            ncm_bl_checked_at = COALESCE($6, ncm_bl_checked_at),
            freight_bl_checked_at = COALESCE($7, freight_bl_checked_at),
            espelho_built_at = COALESCE($8, espelho_built_at),
            invoice_sent_fenicia_at = COALESCE($9, invoice_sent_fenicia_at),
            signatures_collected_at = COALESCE($10, signatures_collected_at),
            signed_docs_sent_at = COALESCE($11, signed_docs_sent_at),
            di_draft_at = COALESCE($12, di_draft_at),
            updated_at = NOW()
          WHERE process_id = $1
        `,
          [
            processId,
            docsReceivedDate,
            status === 'completed'
              ? 100
              : status === 'validated'
                ? 60
                : status === 'documents_received'
                  ? 30
                  : 10,
            urgency || null,
            savedToFolderAt,
            ncmBlCheckedAt,
            freightBlCheckedAt,
            espelhoBuiltAt,
            invoiceSentFeniciaAt,
            signaturesCollectedAt,
            signedDocsSentAt,
            diDraftAt,
          ],
        );

        updated++;
      } else {
        // INSERT new process
        const result = await client.query(
          `
          INSERT INTO import_processes (
            process_code, brand, status, incoterm,
            port_of_loading, port_of_discharge,
            etd, eta,
            total_fob_value, freight_value, total_cbm,
            exporter_name,
            correction_status,
            ai_extracted_data, notes,
            purchase_ref, vessel_name, bl_number,
            shipping_line, insurance_value, consolidation_ref,
            eta_carrier, eta_actual, container_count,
            freight_agent, origin_city, inspection_type,
            di_number, customs_channel, customs_clearance_at,
            cd_arrival_at, free_time_days,
            numerario_value, numerario_pct,
            created_by, created_at, updated_at
          ) VALUES (
            $1, $2, $3, 'FOB',
            $4, $5,
            $6, $7,
            $8, $9, $10,
            $11,
            $12,
            $13, $14,
            $15, $16, $17,
            $18, $19, $20,
            $21, $22, $23,
            $24, $25, $26,
            $27, $28, $29,
            $30, $31,
            $32, $33,
            1, NOW(), NOW()
          ) RETURNING id
        `,
          [
            processCode,
            brand,
            status,
            portOfLoading,
            portOfDischarge,
            etd,
            eta,
            invoiceValue,
            freight,
            cbm,
            exporterName,
            correctionStatus,
            JSON.stringify(extraData),
            notes,
            purchaseRef,
            vesselName,
            blNumber,
            shippingLine,
            insuranceValue,
            consolidationRef,
            etaCarrier,
            etaActual,
            containerCount,
            freightAgent,
            originCity,
            inspectionType,
            diNumber,
            customsChannel,
            customsClearanceAt,
            cdArrivalAt,
            freeTimeDays,
            numerarioValue,
            numerarioPct,
          ],
        );

        processId = result.rows[0].id;

        // Create follow_up_tracking
        await client.query(
          `
          INSERT INTO follow_up_tracking (
            process_id, documents_received_at,
            overall_progress, notes,
            saved_to_folder_at, ncm_bl_checked_at, freight_bl_checked_at,
            espelho_built_at, invoice_sent_fenicia_at, signatures_collected_at,
            signed_docs_sent_at, di_draft_at,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        `,
          [
            processId,
            docsReceivedDate,
            status === 'completed'
              ? 100
              : status === 'validated'
                ? 60
                : status === 'documents_received'
                  ? 30
                  : 10,
            urgency || null,
            savedToFolderAt,
            ncmBlCheckedAt,
            freightBlCheckedAt,
            espelhoBuiltAt,
            invoiceSentFeniciaAt,
            signaturesCollectedAt,
            signedDocsSentAt,
            diDraftAt,
          ],
        );

        inserted++;
      }

      // Create document_corrections if correction was needed
      if (correctionNeeded || (errorCount && errorCount > 0)) {
        // Check if correction record already exists for this process
        const existingCorrection = await client.query(
          'SELECT id FROM document_corrections WHERE process_id = $1 LIMIT 1',
          [processId],
        );

        const errorTypes = errorTypeRaw
          ? JSON.stringify(
              errorTypeRaw
                .split(/[,;\/]/)
                .map((s) => s.trim())
                .filter(Boolean),
            )
          : null;

        const correctionNotes = errorFileRaw ? `Arquivo: ${errorFileRaw}` : null;

        if (existingCorrection.rows.length === 0) {
          await client.query(
            `
            INSERT INTO document_corrections (
              process_id, correction_needed, error_count, error_types,
              notes, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          `,
            [processId, correctionNeeded, errorCount || 0, errorTypes, correctionNotes],
          );
          correctionsCreated++;
        } else if (doUpdate) {
          await client.query(
            `
            UPDATE document_corrections SET
              correction_needed = $2, error_count = $3, error_types = $4,
              notes = COALESCE($5, notes), updated_at = NOW()
            WHERE process_id = $1
          `,
            [processId, correctionNeeded, errorCount || 0, errorTypes, correctionNotes],
          );
        }
      }

      const total = inserted + updated;
      if (total % 100 === 0 && total > 0) {
        console.log(`  ...processed ${total} (${inserted} new, ${updated} updated)`);
      }
    } catch (err) {
      console.error(`  Error processing ${processCode}:`, err.message);
      errors++;
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total rows processed: ${inserted + updated + skipped + errors}`);
  console.log(`  Created:  ${inserted}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Corrections created: ${correctionsCreated}`);
  console.log('='.repeat(60));

  // Print status distribution
  const counts = await client.query(`
    SELECT status, count(*) as cnt
    FROM import_processes
    GROUP BY status
    ORDER BY cnt DESC
  `);
  console.log('\nProcess status distribution:');
  counts.rows.forEach((r) => console.log(`  ${r.status}: ${r.cnt}`));

  const total = await client.query('SELECT count(*) as total FROM import_processes');
  console.log(`\nTotal processes in DB: ${total.rows[0].total}`);

  const fupTotal = await client.query('SELECT count(*) as total FROM follow_up_tracking');
  console.log(`Total follow-up entries: ${fupTotal.rows[0].total}`);

  // Print new field coverage
  const coverage = await client.query(`
    SELECT
      count(*) as total,
      count(vessel_name) as has_vessel,
      count(bl_number) as has_bl,
      count(purchase_ref) as has_purchase,
      count(shipping_line) as has_shipping_line,
      count(insurance_value) as has_insurance,
      count(consolidation_ref) as has_consolidation,
      count(eta_carrier) as has_eta_carrier,
      count(eta_actual) as has_eta_actual,
      count(container_count) as has_container_count,
      count(freight_agent) as has_freight_agent,
      count(origin_city) as has_origin_city,
      count(inspection_type) as has_inspection,
      count(di_number) as has_di_number,
      count(customs_channel) as has_customs_channel,
      count(customs_clearance_at) as has_clearance,
      count(cd_arrival_at) as has_cd_arrival,
      count(free_time_days) as has_free_time,
      count(numerario_value) as has_numerario_value,
      count(numerario_pct) as has_numerario_pct
    FROM import_processes
  `);
  const c = coverage.rows[0];
  console.log('\nNew field coverage:');
  console.log(`  vessel_name:      ${c.has_vessel}/${c.total}`);
  console.log(`  bl_number:        ${c.has_bl}/${c.total}`);
  console.log(`  purchase_ref:     ${c.has_purchase}/${c.total}`);
  console.log(`  shipping_line:    ${c.has_shipping_line}/${c.total}`);
  console.log(`  insurance_value:  ${c.has_insurance}/${c.total}`);
  console.log(`  consolidation_ref:${c.has_consolidation}/${c.total}`);
  console.log(`  eta_carrier:      ${c.has_eta_carrier}/${c.total}`);
  console.log(`  eta_actual:       ${c.has_eta_actual}/${c.total}`);
  console.log(`  container_count:  ${c.has_container_count}/${c.total}`);
  console.log(`  freight_agent:    ${c.has_freight_agent}/${c.total}`);
  console.log(`  origin_city:      ${c.has_origin_city}/${c.total}`);
  console.log(`  inspection_type:  ${c.has_inspection}/${c.total}`);
  console.log(`  di_number:        ${c.has_di_number}/${c.total}`);
  console.log(`  customs_channel:  ${c.has_customs_channel}/${c.total}`);
  console.log(`  customs_clearance:${c.has_clearance}/${c.total}`);
  console.log(`  cd_arrival_at:    ${c.has_cd_arrival}/${c.total}`);
  console.log(`  free_time_days:   ${c.has_free_time}/${c.total}`);
  console.log(`  numerario_value:  ${c.has_numerario_value}/${c.total}`);
  console.log(`  numerario_pct:    ${c.has_numerario_pct}/${c.total}`);

  const corrTotal = await client.query('SELECT count(*) as total FROM document_corrections');
  console.log(`\nTotal correction records: ${corrTotal.rows[0].total}`);

  await client.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
