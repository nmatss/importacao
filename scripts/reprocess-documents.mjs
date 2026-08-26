#!/usr/bin/env node
/**
 * Reprocessamento documental em lote sobre as rotas HTTP existentes.
 *
 * Contexto: docs/STATUS-2026-08-03-REPROCESSAMENTO-DOCUMENTAL.md apurou que o
 * portal so tem `POST /api/documents/:id/reprocess` (unitario) — nao existe
 * endpoint, job ou script de lote, nao existe batch ID e nao existe retomada.
 * Este script cobre a lacuna do lado do operador, sem tocar no banco: ele so
 * consome endpoints ja publicados e ja autenticados.
 *
 * PADRAO SEGURO
 *   - dry-run e o DEFAULT; sem `--execute` nenhum POST e emitido;
 *   - o DEMO (process_id 264) sai por ID, nao por busca textual;
 *   - selecao canonica: 1 documento por (processo, tipo), o mais recente;
 *   - ritmo proprio de 1 requisicao a cada `--delay-ms`. O rate limiter da rota
 *     e por `req.path`, entao cada documento cai num bucket diferente e NAO
 *     protege o worker — o freio tem de vir daqui;
 *   - log JSONL append-only com batch ID; `--resume` pula o que ja concluiu.
 *   - `--wait-per-process` espera cada processo chegar a estado terminal antes
 *     de iniciar o seguinte;
 *   - espelho PDF fica fora por padrao: o parser seguro de espelho exige XLSX.
 *
 * NAO faz: reclassificacao, escrita direta no banco ou supressao por conta
 * propria. Para uma janela sem publicacao externa, suba a API com o override
 * `docker-compose.reprocess.yml`, valide que Drive/Chat ficaram vazios e
 * restaure o compose normal ao terminar.
 *
 * Uso:
 *   API_TOKEN=<jwt admin> node scripts/reprocess-documents.mjs            # dry-run
 *   API_TOKEN=<jwt admin> node scripts/reprocess-documents.mjs --execute
 *
 * Env:
 *   API_BASE_URL  default http://localhost:3000
 *   API_TOKEN     obrigatorio (Bearer). Nunca passe o token por argumento.
 */

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Tipos com extractor dedicado (apps/api/src/modules/documents/service.ts).
// `other` fica de fora de proposito: sem extractor, o reprocessamento so gera
// alerta e ruido — os `other` precisam de triagem manual antes.
const DEFAULT_TYPES = [
  'invoice',
  'proforma_invoice',
  'packing_list',
  'ohbl',
  'draft_bl',
  'draft_duimp',
  'duimp',
  'certificate',
  'espelho',
];

function parseArgs(argv) {
  const args = {
    execute: false,
    canonicalOnly: true,
    excludeProcessIds: new Set([264]), // DEMO-IM0712602NB-E227210
    processIds: null,
    documentIds: null,
    types: new Set(DEFAULT_TYPES),
    delayMs: 6500,
    limit: Infinity,
    out: null,
    resume: null,
    fromEtd: null,
    includeNullEtd: false,
    includeUnsupportedEspelho: false,
    waitPerProcess: false,
    pollMs: 5000,
    waitTimeoutMs: 30 * 60 * 1000,
  };

  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (flag) {
      case '--execute':
        args.execute = true;
        break;
      case '--all-versions':
        args.canonicalOnly = false;
        break;
      case '--exclude-process-id':
        args.excludeProcessIds.add(Number(value));
        break;
      case '--include-demo':
        args.excludeProcessIds.delete(264);
        break;
      case '--process-id':
        args.processIds ??= new Set();
        for (const id of String(value).split(',')) args.processIds.add(Number(id));
        break;
      case '--document-id':
        args.documentIds ??= new Set();
        for (const id of String(value).split(',')) args.documentIds.add(Number(id));
        break;
      case '--type':
        args.types = new Set(String(value).split(','));
        break;
      case '--delay-ms':
        args.delayMs = Number(value);
        break;
      case '--limit':
        args.limit = Number(value);
        break;
      case '--out':
        args.out = value;
        break;
      case '--resume':
        args.resume = value;
        break;
      case '--from-etd':
        args.fromEtd = value;
        break;
      case '--include-null-etd':
        args.includeNullEtd = true;
        break;
      case '--include-unsupported-espelho':
        args.includeUnsupportedEspelho = true;
        break;
      case '--wait-per-process':
        args.waitPerProcess = true;
        break;
      case '--poll-ms':
        args.pollMs = Number(value);
        break;
      case '--wait-timeout-ms':
        args.waitTimeoutMs = Number(value);
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
  if (args.fromEtd && !/^\d{4}-\d{2}-\d{2}$/.test(args.fromEtd)) {
    throw new Error('--from-etd deve usar YYYY-MM-DD');
  }
  for (const [name, value] of [
    ['--delay-ms', args.delayMs],
    ['--poll-ms', args.pollMs],
    ['--wait-timeout-ms', args.waitTimeoutMs],
  ]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} deve ser positivo`);
  }
  return args;
}

const BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
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
    const message = body?.error || body?.message || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function listProcesses() {
  const collected = [];
  for (let page = 1; ; page += 1) {
    const body = await apiFetch(`/api/processes?page=${page}&limit=100`);
    const rows = body.data ?? [];
    collected.push(...rows);
    const pages = body.pagination?.pages ?? 1;
    if (page >= pages || rows.length === 0) break;
  }
  return collected;
}

/**
 * 1 documento por (processo, tipo): o mais recente vence, empate resolvido pelo
 * maior id. Sem isso, versoes historicas do mesmo tipo disputam a projecao do
 * processo com a versao operacional atual.
 */
function selectCanonical(docs) {
  const best = new Map();
  for (const doc of docs) {
    const current = best.get(doc.documentType);
    if (!current) {
      best.set(doc.documentType, doc);
      continue;
    }
    const a = Date.parse(doc.uploadedAt ?? '') || 0;
    const b = Date.parse(current.uploadedAt ?? '') || 0;
    if (a > b || (a === b && doc.id > current.id)) best.set(doc.documentType, doc);
  }
  return [...best.values()];
}

function loadDone(resumePath) {
  const done = new Set();
  if (!resumePath || !existsSync(resumePath)) return done;
  for (const line of readFileSync(resumePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.documentId && entry.status === 'enqueued') done.add(entry.documentId);
    } catch {
      // linha parcial de uma execucao interrompida — ignora
    }
  }
  return done;
}

function isInsideProcessWindow(proc, args) {
  if (!args.fromEtd) return true;
  if (!proc.etd) return args.includeNullEtd;
  return String(proc.etd).slice(0, 10) >= args.fromEtd;
}

function isSupportedEspelho(doc, args) {
  if (doc.documentType !== 'espelho' || args.includeUnsupportedEspelho) return true;
  const mime = String(doc.mimeType ?? '').toLowerCase();
  const filename = String(doc.fileName ?? '').toLowerCase();
  return (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    filename.endsWith('.xlsx')
  );
}

async function waitForProcessTargets(processId, targets, args, batchId, outPath) {
  const targetIds = new Set(targets.map((target) => target.documentId));
  const deadline = Date.now() + args.waitTimeoutMs;

  while (Date.now() < deadline) {
    const body = await apiFetch(`/api/documents/process/${processId}`);
    const rows = (body.data ?? []).filter((doc) => targetIds.has(doc.id));
    const byId = new Map(rows.map((doc) => [doc.id, doc]));
    const missing = targets.filter((target) => !byId.has(target.documentId));
    if (missing.length > 0) {
      throw new Error(
        `Documentos desapareceram durante o replay: ${missing.map((target) => target.documentId).join(',')}`,
      );
    }

    const processing = targets.filter(
      (target) => byId.get(target.documentId)?.aiProcessingStatus === 'processing',
    );
    if (processing.length === 0) {
      const failed = targets.filter(
        (target) => byId.get(target.documentId)?.aiProcessingStatus === 'failed',
      );
      for (const target of targets) {
        const status = byId.get(target.documentId)?.aiProcessingStatus;
        appendFileSync(
          outPath,
          `${JSON.stringify({
            batchId,
            at: new Date().toISOString(),
            ...target,
            status: status === 'completed' ? 'terminal_completed' : 'terminal_failed',
          })}\n`,
        );
      }
      return { completed: targets.length - failed.length, failed: failed.length };
    }

    console.log(
      `[${batchId}] proc=${processId} aguardando ${processing.length}/${targets.length} documento(s)`,
    );
    await sleep(args.pollMs);
  }

  throw new Error(
    `Timeout aguardando processo ${processId} apos ${Math.round(args.waitTimeoutMs / 60000)} min`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!TOKEN) throw new Error('API_TOKEN ausente no ambiente.');

  const batchId = `reproc-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outPath = args.out ?? `/tmp/${batchId}.jsonl`;
  const alreadyDone = loadDone(args.resume);

  console.log(`[${batchId}] base=${BASE_URL} modo=${args.execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`[${batchId}] excluindo process_id: ${[...args.excludeProcessIds].join(', ')}`);

  const processes = await listProcesses();
  const targets = [];

  for (const proc of processes) {
    if (args.excludeProcessIds.has(proc.id)) continue;
    if (args.processIds && !args.processIds.has(proc.id)) continue;
    if (!isInsideProcessWindow(proc, args)) continue;

    const docs = await apiFetch(`/api/documents/process/${proc.id}`);
    const rows = (docs.data ?? []).filter(
      (doc) => args.types.has(doc.documentType) && isSupportedEspelho(doc, args),
    );
    const selected = args.documentIds
      ? rows.filter((doc) => args.documentIds.has(doc.id))
      : args.canonicalOnly
        ? selectCanonical(rows)
        : rows;
    for (const doc of selected) {
      if (alreadyDone.has(doc.id)) continue;
      targets.push({
        processId: proc.id,
        processCode: proc.processCode,
        processStatus: proc.status,
        documentId: doc.id,
        documentType: doc.documentType,
        filename: doc.fileName,
        confidence: doc.aiConfidence ?? null,
      });
    }
  }

  const plan = targets.slice(0, args.limit);
  const byType = plan.reduce(
    (acc, t) => ({ ...acc, [t.documentType]: (acc[t.documentType] ?? 0) + 1 }),
    {},
  );
  console.log(`[${batchId}] processos elegiveis: ${new Set(plan.map((t) => t.processId)).size}`);
  console.log(`[${batchId}] documentos no lote: ${plan.length}`, byType);
  if (args.fromEtd) {
    console.log(
      `[${batchId}] janela ETD: >=${args.fromEtd}; ETD nulo=${args.includeNullEtd ? 'incluido' : 'excluido'}`,
    );
  }

  // A state machine nao aceita completed -> validating: a extracao termina mas a
  // revalidacao automatica falha. Sinalizado, nao bloqueado.
  const completed = plan.filter((t) => t.processStatus === 'completed');
  if (completed.length) {
    console.warn(
      `[${batchId}] ATENCAO: ${completed.length} documento(s) em processo 'completed' — ` +
        `revalidacao automatica vai falhar. Trate com --process-id separado.`,
    );
  }

  if (!args.execute) {
    for (const t of plan) {
      console.log(
        `  DRY-RUN doc=${t.documentId} ${t.documentType} proc=${t.processCode} ${t.filename}`,
      );
    }
    const minutes = ((plan.length * args.delayMs) / 60000).toFixed(1);
    console.log(
      `[${batchId}] dry-run concluido. Nenhuma escrita. Enfileiramento levaria ~${minutes} min.`,
    );
    return;
  }

  let ok = 0;
  let failed = 0;
  let terminalCompleted = 0;
  let terminalFailed = 0;
  const grouped = new Map();
  for (const target of plan) {
    const group = grouped.get(target.processId) ?? [];
    group.push(target);
    grouped.set(target.processId, group);
  }
  const processGroups = [...grouped.entries()];
  let globalIndex = 0;

  for (const [processIndex, [processId, processTargets]] of processGroups.entries()) {
    const enqueuedTargets = [];
    for (const target of processTargets) {
      globalIndex += 1;
      const record = { batchId, at: new Date().toISOString(), ...target };
      try {
        await apiFetch(`/api/documents/${target.documentId}/reprocess`, { method: 'POST' });
        ok += 1;
        enqueuedTargets.push(target);
        appendFileSync(outPath, `${JSON.stringify({ ...record, status: 'enqueued' })}\n`);
        console.log(
          `  [${globalIndex}/${plan.length}] OK doc=${target.documentId} ${target.documentType}`,
        );
      } catch (error) {
        failed += 1;
        appendFileSync(
          outPath,
          `${JSON.stringify({ ...record, status: 'enqueue_failed', error: error.message, httpStatus: error.status ?? null })}\n`,
        );
        console.error(
          `  [${globalIndex}/${plan.length}] FALHA doc=${target.documentId}: ${error.message}`,
        );
      }
      if (globalIndex < plan.length) await sleep(args.delayMs);
    }

    if (args.waitPerProcess && enqueuedTargets.length > 0) {
      try {
        const terminal = await waitForProcessTargets(
          processId,
          enqueuedTargets,
          args,
          batchId,
          outPath,
        );
        terminalCompleted += terminal.completed;
        terminalFailed += terminal.failed;
        console.log(
          `[${batchId}] proc=${processId} terminal: completos=${terminal.completed} falhos=${terminal.failed}`,
        );
      } catch (error) {
        failed += enqueuedTargets.length;
        appendFileSync(
          outPath,
          `${JSON.stringify({
            batchId,
            at: new Date().toISOString(),
            processId,
            status: 'wait_failed',
            error: error.message,
          })}\n`,
        );
        console.error(`[${batchId}] proc=${processId} FALHA NA ESPERA: ${error.message}`);
        break;
      }
    }

    if (processIndex < processGroups.length - 1 && globalIndex < plan.length) {
      await sleep(args.delayMs);
    }
  }

  console.log(
    `[${batchId}] enfileirados=${ok} falhas=${failed} ` +
      `terminais_ok=${terminalCompleted} terminais_falha=${terminalFailed} log=${outPath}`,
  );
  if (failed || terminalFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
