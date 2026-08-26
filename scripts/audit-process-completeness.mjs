#!/usr/bin/env node
/**
 * Auditoria resumivel de completude e validacao dos processos.
 *
 * Seguro por padrao:
 * - sem --execute apenas inventaria o escopo;
 * - o modo executavel padrao e `partial`, que nao altera workflow nem publica;
 * - o JSONL nao inclui valores comerciais, nomes, enderecos ou payloads;
 * - nunca imprime nem aceita token por argumento.
 *
 * Uso:
 *   API_TOKEN=<jwt> node scripts/audit-process-completeness.mjs
 *   API_TOKEN=<jwt> node scripts/audit-process-completeness.mjs --execute \
 *     --out=/diretorio-privado/process-completeness.jsonl
 */

import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const COMPLETENESS_FIELDS = [
  'processCode',
  'brand',
  'status',
  'purchaseRef',
  'exporterName',
  'importerName',
  'portOfLoading',
  'portOfDischarge',
  'etd',
  'eta',
  'shipmentDate',
  'totalFobValue',
  'freightValue',
  'totalBoxes',
  'totalNetWeight',
  'totalGrossWeight',
  'totalCbm',
  'vesselName',
  'blNumber',
  'shippingLine',
  'containerCount',
  'freightAgent',
];

const CORE_DOCUMENT_TYPES = new Set(['invoice', 'packing_list']);
const BL_DOCUMENT_TYPES = new Set(['ohbl', 'draft_bl']);

function parseArgs(argv) {
  const args = {
    execute: false,
    mode: 'partial',
    allowFinalEffects: false,
    processIds: null,
    limit: Infinity,
    delayMs: 750,
    out: null,
    resume: null,
  };

  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (flag) {
      case '--execute':
        args.execute = true;
        break;
      case '--mode':
        args.mode = value;
        break;
      case '--allow-final-effects':
        args.allowFinalEffects = true;
        break;
      case '--process-id':
        args.processIds ??= new Set();
        for (const id of String(value).split(',')) args.processIds.add(Number(id));
        break;
      case '--limit':
        args.limit = Number(value);
        break;
      case '--delay-ms':
        args.delayMs = Number(value);
        break;
      case '--out':
        args.out = value;
        break;
      case '--resume':
        args.resume = value;
        break;
      case '--help':
      case '-h':
        console.log(
          readFileSync(new URL(import.meta.url))
            .toString()
            .split('*/')[0],
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Flag desconhecida: ${flag}`);
    }
  }

  if (!['partial', 'final'].includes(args.mode)) {
    throw new Error('--mode deve ser partial ou final');
  }
  if (args.mode === 'final' && !args.allowFinalEffects) {
    throw new Error('--mode=final exige --allow-final-effects');
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error('--delay-ms deve ser zero ou positivo');
  }
  if (args.limit !== Infinity && (!Number.isFinite(args.limit) || args.limit <= 0)) {
    throw new Error('--limit deve ser positivo');
  }
  return args;
}

const BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const TOKEN = process.env.API_TOKEN;

async function apiFetch(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error || body?.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function listProcesses() {
  const processes = [];
  for (let page = 1; ; page += 1) {
    const body = await apiFetch(`/api/processes?page=${page}&limit=100`);
    const rows = body.data ?? [];
    processes.push(...rows);
    if (page >= (body.pagination?.pages ?? 1) || rows.length === 0) break;
  }
  return processes;
}

function loadCompleted(resumePath) {
  const completed = new Set();
  if (!resumePath || !existsSync(resumePath)) return completed;
  for (const line of readFileSync(resumePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.kind === 'process' && row.status === 'completed') completed.add(row.processId);
    } catch {
      // An interrupted final line is ignored and safely retried.
    }
  }
  return completed;
}

function isPresent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function summarize(process, docs, results, batchId, validationMode) {
  const types = docs.map((doc) => doc.documentType);
  const typeCounts = Object.fromEntries(
    [...new Set(types)].sort().map((type) => [type, types.filter((item) => item === type).length]),
  );
  const missingFields = COMPLETENESS_FIELDS.filter((field) => !isPresent(process[field]));
  const presentFields = COMPLETENESS_FIELDS.filter((field) => isPresent(process[field]));
  const failedChecks = results.filter((result) => result.status === 'failed');
  const warningChecks = results.filter((result) => result.status === 'warning');
  const skippedChecks = results.filter((result) => result.status === 'skipped');
  const hasCore = [...CORE_DOCUMENT_TYPES].every((type) => types.includes(type));
  const hasBl = types.some((type) => BL_DOCUMENT_TYPES.has(type));
  const itemBearingDocuments = docs.filter((doc) => Array.isArray(doc.aiParsedData?.items)).length;

  let evidenceState = 'ready_for_human_approval';
  if (docs.length === 0) evidenceState = 'master_only_no_document_source';
  else if (types.every((type) => type === 'other'))
    evidenceState = 'manual_classification_required';
  else if (!hasCore || !hasBl) evidenceState = 'document_set_incomplete';
  else if (failedChecks.length > 0) evidenceState = 'automated_checks_failed';
  else if (warningChecks.length > 0 || skippedChecks.length > 0)
    evidenceState = 'automated_checks_with_exceptions';

  return {
    kind: 'process',
    status: 'completed',
    batchId,
    assessedAt: new Date().toISOString(),
    processId: process.id,
    processCode: process.processCode,
    brand: process.brand,
    workflowStatus: process.status,
    sourceCoverage: docs.length === 0 ? 'master_only' : 'master_and_documents',
    fieldCompleteness: {
      evaluated: COMPLETENESS_FIELDS.length,
      present: presentFields.length,
      missing: missingFields,
    },
    documentCoverage: {
      total: docs.length,
      types: typeCounts,
      completeCoreSet: hasCore && hasBl,
      belowConfidence090: docs.filter((doc) => Number(doc.aiConfidence ?? 0) < 0.9).length,
      withoutLineageEvidence: docs.filter((doc) => !doc.hasLineageEvidence).length,
      itemBearingDocuments,
    },
    validation: {
      mode: validationMode,
      total: results.length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: failedChecks.map((result) => result.checkName),
      warnings: warningChecks.map((result) => result.checkName),
      skipped: skippedChecks.map((result) => result.checkName),
    },
    evidenceState,
    automaticApproval: false,
    humanApprovalRequired: true,
  };
}

function appendEvidence(path, value) {
  appendFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!TOKEN) throw new Error('API_TOKEN ausente no ambiente');

  const completed = loadCompleted(args.resume);
  const batchId = `completeness-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outPath = args.out ?? `/tmp/${batchId}.jsonl`;
  const allProcesses = await listProcesses();
  const selected = allProcesses
    .filter((process) => !args.processIds || args.processIds.has(process.id))
    .filter((process) => !completed.has(process.id))
    .slice(0, args.limit);

  console.log(
    `[${batchId}] modo=${args.execute ? `EXECUTE/${args.mode}` : 'DRY-RUN'} processos=${selected.length}`,
  );
  if (!args.execute) return;

  let succeeded = 0;
  let failed = 0;
  for (const [index, listedProcess] of selected.entries()) {
    try {
      const [processBody, docsBody, validationBody] = await Promise.all([
        apiFetch(`/api/processes/${listedProcess.id}`),
        apiFetch(`/api/documents/process/${listedProcess.id}`),
        apiFetch(`/api/validation/${listedProcess.id}/run`, {
          method: 'POST',
          body: JSON.stringify({ mode: args.mode }),
        }),
      ]);
      const docs = docsBody.data ?? [];
      const lineage = await Promise.all(
        docs.map((doc) => apiFetch(`/api/documents/${doc.id}/extraction-evidence`)),
      );
      for (const [docIndex, doc] of docs.entries()) {
        doc.hasLineageEvidence = Boolean(lineage[docIndex]?.data?.run);
      }
      const evidence = summarize(
        processBody.data,
        docs,
        validationBody.data ?? [],
        batchId,
        args.mode,
      );
      appendEvidence(outPath, evidence);
      succeeded += 1;
      console.log(
        `[${batchId}] ${index + 1}/${selected.length} processId=${listedProcess.id} estado=${evidence.evidenceState}`,
      );
    } catch (error) {
      failed += 1;
      appendEvidence(outPath, {
        kind: 'process',
        status: 'failed',
        batchId,
        assessedAt: new Date().toISOString(),
        processId: listedProcess.id,
        error: 'request_failed',
        httpStatus: Number.isInteger(error?.status) ? error.status : null,
      });
      console.error(`[${batchId}] processId=${listedProcess.id} falhou; consulte o JSONL privado`);
    }
    if (args.delayMs > 0) await sleep(args.delayMs);
  }

  appendEvidence(outPath, {
    kind: 'summary',
    batchId,
    completedAt: new Date().toISOString(),
    selected: selected.length,
    succeeded,
    failed,
  });
  console.log(`[${batchId}] concluido=${succeeded} falhou=${failed} evidencia=${outPath}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
