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
 *
 * NAO faz: reclassificacao, escrita direta no banco, supressao de Drive/Chat.
 * Enquanto o modo de manutencao da Fase 0 nao existir, cada reprocessamento
 * ainda dispara validacao, Drive e alertas — rode em janela combinada.
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
    types: new Set(DEFAULT_TYPES),
    delayMs: 6500,
    limit: Infinity,
    out: null,
    resume: null,
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

    const docs = await apiFetch(`/api/documents/process/${proc.id}`);
    const rows = (docs.data ?? []).filter((doc) => args.types.has(doc.documentType));
    const selected = args.canonicalOnly ? selectCanonical(rows) : rows;
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
  for (const [index, target] of plan.entries()) {
    const record = { batchId, at: new Date().toISOString(), ...target };
    try {
      await apiFetch(`/api/documents/${target.documentId}/reprocess`, { method: 'POST' });
      ok += 1;
      appendFileSync(outPath, `${JSON.stringify({ ...record, status: 'enqueued' })}\n`);
      console.log(
        `  [${index + 1}/${plan.length}] OK doc=${target.documentId} ${target.documentType}`,
      );
    } catch (error) {
      failed += 1;
      appendFileSync(
        outPath,
        `${JSON.stringify({ ...record, status: 'failed', error: error.message, httpStatus: error.status ?? null })}\n`,
      );
      console.error(
        `  [${index + 1}/${plan.length}] FALHA doc=${target.documentId}: ${error.message}`,
      );
    }
    if (index < plan.length - 1) await sleep(args.delayMs);
  }

  console.log(`[${batchId}] enfileirados=${ok} falhas=${failed} log=${outPath}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
