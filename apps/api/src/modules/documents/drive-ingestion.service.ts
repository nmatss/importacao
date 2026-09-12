import fs from 'fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { eq, isNotNull } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import {
  documentIngestionTombstones,
  documents,
  espelhos,
  importProcesses,
} from '../../shared/database/schema.js';
import {
  googleDriveService,
  type DriveEspelhoFile,
  type DriveProcessIndex,
} from '../integrations/google-drive.service.js';
import { UPLOAD_DIR } from '../../shared/config/paths.js';
import { logger } from '../../shared/utils/logger.js';
import { isFileBufferTypeCompatible } from '../../shared/middleware/upload.js';
import { documentService } from './service.js';
import {
  getFollowUpReferences,
  getReferenceSource,
  normalizeReference,
} from '../follow-up/reference-registry.js';
import { isDriveIngestionEnabled } from './source-policy.js';
import {
  EMPTY_DRIVE_AREAS,
  setDriveSweepStatus,
  type DriveIgnoredFile,
  type DriveIngestionResult,
  type DriveSweepStatus,
} from './drive-sweep-status.js';
import {
  FOLDER_MIME,
  XLSX_MIME,
  classifyDriveFile,
  isTypeSubfolder,
  isVersionamentoSubfolder,
  nameReferencesCode,
  selectByDocumentTypePriority,
  type DriveArea,
  type DriveProcessArea,
} from './drive-layout.js';
export {
  getDriveSweepStatus,
  getDriveSweepStatusForProcess,
  minutesSinceLastSweep,
  __resetDriveSweepStatus,
  type DriveIgnoredFile,
  type DriveIngestionResult,
  type DriveSweepFolder,
  type DriveSweepStatus,
} from './drive-sweep-status.js';
export {
  getDocumentSource,
  getDocumentSourcePolicy,
  isDriveIngestionEnabled,
  isEmailIngestionEnabled,
  isManualDocumentUploadEnabled,
} from './source-policy.js';

/**
 * Le os documentos do processo na pasta PROCESSOS do time (reuniao 11/09/2026).
 *
 * Pedido da Eduarda (17/08/2026): "eu ficaria mais segura se agora no inicio
 * considerasse so o que incluimos na pasta do processo no drive mesmo". Em
 * 11/09 a decisao ficou mais especifica (D1): a fonte e um INDICE de pastas
 * montado por varredura, com prioridade POR TIPO — o que esta em
 * '04. PENDENTES DE CORREÇÃO' vence, os tipos que faltarem vem da pasta da
 * marca, e o espelho vem sempre de '01. ESPELHOS'.
 *
 * DOCUMENT_SOURCE decide quem alimenta os processos:
 *   email           — comportamento historico, este job nao roda
 *   drive (default) — so a pasta do processo no Drive
 *   both            — as duas fontes
 */

const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

function maxFileBytes(): number {
  const raw = Number(process.env.DRIVE_INGESTION_MAX_FILE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_FILE_BYTES;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Numero do Drive que vem como string; valor nao numerico vira `null`. */
function numeroOuNulo(valor: string | null | undefined): number | null {
  if (valor == null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

interface DriveCandidateFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number | null;
  md5: string | null;
  version: number | null;
  modifiedTime: string | null;
  nativo: boolean;
}

interface ProcessKnownState {
  /** driveFileId dos espelhos que o PROPRIO sistema publicou — nunca reimportar. */
  espelhoDriveFileIds: Set<string>;
  /** driveFileId -> versao do Drive ja importada, para evitar reexportar Sheets. */
  versionByFileId: Map<string, number | null>;
  md5s: Set<string>;
  shas: Set<string>;
  tombstoneFileIds: Set<string>;
  tombstoneShas: Set<string>;
}

/** Hash pre-migration files in memory only: no source writes or DB backfill. */
async function hashLegacyUpload(storagePath: string | null): Promise<{ sha: string; md5: string }> {
  if (!storagePath) throw new Error('missing_path');
  const root = await fs.realpath(UPLOAD_DIR);
  const candidate = await fs.realpath(storagePath);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('outside_upload_dir');
  }
  const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('not_regular_file');
    if (stat.size > maxFileBytes()) throw new Error('size_limit');
    const sha = createHash('sha256');
    const md5 = createHash('md5');
    const chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maxFileBytes()) throw new Error('size_limit');
      sha.update(chunk.subarray(0, bytesRead));
      md5.update(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (total !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw new Error('file_changed_during_read');
    }
    return { sha: sha.digest('hex'), md5: md5.digest('hex') };
  } finally {
    await handle.close();
  }
}

async function loadKnownState(processId: number): Promise<ProcessKnownState> {
  const docRows = await db
    .select({
      id: documents.id,
      storagePath: documents.storagePath,
      driveFileId: documents.driveFileId,
      driveMd5: documents.driveMd5,
      driveVersion: documents.driveVersion,
      contentSha256: documents.contentSha256,
    })
    .from(documents)
    .where(eq(documents.processId, processId));

  // O espelho gerado pelo sistema tambem foi enviado para a pasta do processo
  // no layout antigo, mas o `driveFileId` dele fica em `espelhos`, nao em
  // `documents`. Sem conferir a outra tabela, cada espelho publicado voltaria
  // como um `documents` novo na varredura seguinte.
  const espelhoRows = await db
    .select({ driveFileId: espelhos.driveFileId })
    .from(espelhos)
    .where(eq(espelhos.processId, processId));

  // Documento excluido pela analista NAO volta sozinho (D8): sem esta consulta
  // a varredura seguinte reimportaria o mesmo arquivo em ate 10 minutos.
  const tombstoneRows = await db
    .select({
      driveFileId: documentIngestionTombstones.driveFileId,
      contentSha256: documentIngestionTombstones.contentSha256,
    })
    .from(documentIngestionTombstones)
    .where(eq(documentIngestionTombstones.processId, processId));

  const state: ProcessKnownState = {
    espelhoDriveFileIds: new Set(),
    versionByFileId: new Map(),
    md5s: new Set(),
    shas: new Set(),
    tombstoneFileIds: new Set(),
    tombstoneShas: new Set(),
  };

  for (const row of docRows) {
    if (row.driveFileId) {
      const previous = state.versionByFileId.get(row.driveFileId);
      // Database row order is not guaranteed; a historical revision must not
      // replace the latest already-ingested revision in the dedupe snapshot.
      if (previous == null || (row.driveVersion != null && row.driveVersion > previous)) {
        state.versionByFileId.set(row.driveFileId, row.driveVersion ?? null);
      }
    }
    if (row.driveMd5) state.md5s.add(row.driveMd5);
    if (row.contentSha256) state.shas.add(row.contentSha256);
    else {
      try {
        const hashes = await hashLegacyUpload(row.storagePath);
        state.shas.add(hashes.sha);
        state.md5s.add(hashes.md5);
      } catch (error) {
        // Paths and file contents are private. A missing hash remains unknown,
        // never a fabricated fingerprint or a successful reconciliation.
        const code = (error as NodeJS.ErrnoException).code;
        const message = (error as Error).message;
        const knownReason = [
          'missing_path',
          'outside_upload_dir',
          'not_regular_file',
          'size_limit',
          'file_changed_during_read',
        ].includes(message)
          ? message
          : 'filesystem_error';
        logger.warn(
          {
            processId,
            documentId: row.id,
            reason: ['ENOENT', 'EACCES', 'ELOOP'].includes(code ?? '') ? code : knownReason,
          },
          'Legacy document hash unavailable — content dedupe incomplete',
        );
      }
    }
  }
  for (const row of espelhoRows)
    if (row.driveFileId) state.espelhoDriveFileIds.add(row.driveFileId);
  for (const row of tombstoneRows) {
    if (row.driveFileId) state.tombstoneFileIds.add(row.driveFileId);
    if (row.contentSha256) state.tombstoneShas.add(row.contentSha256);
  }

  return state;
}

function toCandidateFile(file: {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  md5Checksum?: string | null;
  version?: string | null;
  modifiedTime?: string | null;
}): DriveCandidateFile | null {
  if (!file.id || !file.name) return null;
  return {
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType ?? 'application/octet-stream',
    size: numeroOuNulo(file.size),
    md5: file.md5Checksum ?? null,
    version: numeroOuNulo(file.version),
    modifiedTime: file.modifiedTime ?? null,
    nativo: Boolean(file.mimeType?.startsWith('application/vnd.google-apps')),
  };
}

function espelhoToCandidate(espelho: DriveEspelhoFile): DriveCandidateFile {
  return {
    fileId: espelho.fileId,
    name: espelho.nativo ? `${espelho.name}.xlsx` : espelho.name,
    mimeType: espelho.nativo ? XLSX_MIME : espelho.mimeType,
    size: espelho.size,
    md5: espelho.nativo ? null : espelho.md5,
    version: espelho.version,
    modifiedTime: espelho.modifiedTime,
    nativo: espelho.nativo,
  };
}

interface SelectedCandidate {
  area: DriveProcessArea | 'espelhos';
  docType: string;
  file: DriveCandidateFile;
  folderPath: string;
}

/**
 * Lista os arquivos de UMA pasta de processo.
 *
 * Desce apenas nas subpastas por tipo do layout antigo do proprio sistema
 * (Invoice/Packing List/BL/Espelho/Outros). Nunca em 'Backup' e afins: a pasta
 * real do PK2202608SZ tem um `Backup/` com a invoice ANTIGA, e a recursao
 * ingenua importaria duas invoices do mesmo processo.
 */
async function listProcessFolderFiles(
  folderId: string,
  folderPath: string,
  ignored: DriveIgnoredFile[],
): Promise<DriveCandidateFile[]> {
  const arquivos: DriveCandidateFile[] = [];
  const entries = await googleDriveService.listFolderEntries(folderId);

  for (const entry of entries) {
    if (!entry.id || !entry.name) continue;
    if (entry.mimeType === FOLDER_MIME) {
      if (isVersionamentoSubfolder(entry.name)) {
        ignored.push({
          name: `${folderPath}/${entry.name}`,
          reason: 'subpasta de versao anterior (backup) — nao lida',
        });
        continue;
      }
      if (!isTypeSubfolder(entry.name)) {
        ignored.push({
          name: `${folderPath}/${entry.name}`,
          reason: 'subpasta desconhecida — a varredura nao desce nela',
        });
        continue;
      }
      for (const filho of await googleDriveService.listFolderEntries(entry.id)) {
        if (filho.mimeType === FOLDER_MIME) continue;
        const candidato = toCandidateFile(filho);
        if (candidato) arquivos.push(candidato);
      }
      continue;
    }
    const candidato = toCandidateFile(entry);
    if (candidato) arquivos.push(candidato);
  }

  return arquivos;
}

/**
 * Ingest one process. Returns counts; never throws for a single bad file so a
 * batch cannot be aborted by one unreadable document.
 */
export async function ingestProcessFromDrive(
  process: { id: number; processCode: string; brand: string },
  index: DriveProcessIndex,
): Promise<DriveIngestionResult> {
  const result: DriveIngestionResult = {
    processId: process.id,
    processCode: process.processCode,
    imported: 0,
    skipped: 0,
    failed: 0,
    folders: [],
    ignored: [],
  };

  const normalizedCode = normalizeReference(process.processCode);
  const pastas = index.byCode.get(normalizedCode) ?? [];
  const espelhosDoProcesso = index.espelhosByCode.get(normalizedCode) ?? [];

  for (const pasta of pastas) {
    result.folders.push({ area: pasta.area, path: pasta.path, folderId: pasta.folderId });
  }

  if (pastas.length === 0 && espelhosDoProcesso.length === 0) {
    const consultadas = (Object.keys(index.areas) as DriveArea[])
      .filter((area) => index.areas[area])
      .map((area) => index.areas[area]!.name)
      .join(', ');
    result.skippedReason = consultadas
      ? `nenhuma pasta encontrada no Drive (areas consultadas: ${consultadas})`
      : 'nenhuma area da pasta PROCESSOS foi resolvida';
    return result;
  }

  // ── Candidatos por pasta, com prioridade POR TIPO ────────────────────
  const candidatos: Array<{ area: DriveProcessArea; docType: string; file: DriveCandidateFile }> =
    [];
  const caminhoPorArquivo = new Map<string, string>();

  for (const pasta of pastas) {
    const arquivos = await listProcessFolderFiles(pasta.folderId, pasta.path, result.ignored);
    for (const arquivo of arquivos) {
      // Reject a named foreign process before priority selection; otherwise
      // a misplaced pending invoice suppresses the correct brand invoice.
      const namedCodes = [
        ...new Set([
          ...index.byCode.keys(),
          ...index.espelhosByCode.keys(),
          ...(arquivo.name
            .toUpperCase()
            .match(/(?<![A-Z0-9])(?:PK|IM)\d{7}[A-Z]{2}(?![A-Z0-9])/g) ?? []),
        ]),
      ].filter((code) => nameReferencesCode(arquivo.name, code));
      if (namedCodes.some((code) => code !== normalizedCode)) {
        result.ignored.push({
          name: arquivo.name,
          reason: 'arquivo referencia outro processo — revisar associacao na pasta',
        });
        result.skipped += 1;
        continue;
      }
      const decisao = classifyDriveFile(arquivo.name, {
        hasKnownProcessCode: nameReferencesCode(arquivo.name, normalizedCode),
      });
      if (!decisao.docType) {
        result.ignored.push({ name: arquivo.name, reason: decisao.ignoredReason! });
        result.skipped += 1;
        continue;
      }
      candidatos.push({ area: pasta.area, docType: decisao.docType, file: arquivo });
      caminhoPorArquivo.set(arquivo.fileId, pasta.path);
    }
  }

  const selecionados: SelectedCandidate[] = selectByDocumentTypePriority(candidatos).map((c) => ({
    area: c.area,
    docType: c.docType,
    file: c.file,
    folderPath: caminhoPorArquivo.get(c.file.fileId) ?? '',
  }));

  // O que PENDENTES cobriu nao precisa vir da pasta da marca.
  const descartadosPorPrioridade = candidatos.length - selecionados.length;
  if (descartadosPorPrioridade > 0) result.skipped += descartadosPorPrioridade;

  if (espelhosDoProcesso.length > 0) {
    const [espelho, ...outros] = espelhosDoProcesso;
    if (outros.length > 0) {
      result.espelhoAmbiguo = true;
      for (const extra of outros) {
        result.ignored.push({
          name: extra.name,
          reason: 'mais de um espelho para o mesmo processo — usado o mais recente',
        });
        result.skipped += 1;
      }
    }
    const area = index.areas.espelhos;
    selecionados.push({
      area: 'espelhos',
      docType: 'espelho',
      file: espelhoToCandidate(espelho!),
      folderPath: area?.name ?? 'ESPELHOS',
    });
    if (area) {
      result.folders.push({
        area: 'espelhos',
        path: `${area.name}/${espelho!.name}`,
        folderId: area.id,
      });
    }
  }

  // Nada selecionado: nao vale as tres consultas de estado do processo.
  if (selecionados.length === 0) return result;

  const known = await loadKnownState(process.id);

  for (const candidato of selecionados) {
    const { file } = candidato;

    if (known.tombstoneFileIds.has(file.fileId)) {
      result.ignored.push({
        name: file.name,
        reason: 'documento excluido por um analista — nao volta pela varredura',
      });
      result.skipped += 1;
      continue;
    }
    if (known.espelhoDriveFileIds.has(file.fileId)) {
      // Espelho que o proprio sistema publicou no layout antigo.
      result.skipped += 1;
      continue;
    }
    // `known.md5s` recebe cada import bem-sucedido logo abaixo, entao isto
    // tambem deduplica DENTRO da passada (mesmo arquivo em duas pastas do
    // codigo duplicado). Um import que falhou nao bloqueia a copia seguinte.
    if (file.md5 && known.md5s.has(file.md5)) {
      result.skipped += 1;
      continue;
    }
    // Sheets nativo nao tem md5: a versao do Drive evita reexportar um espelho
    // que nao mudou. Quando ela muda, o conteudo e reconferido pelo sha256.
    if (file.version != null && known.versionByFileId.get(file.fileId) === file.version) {
      result.skipped += 1;
      continue;
    }
    if (file.size != null && file.size > maxFileBytes()) {
      logger.warn(
        { processCode: process.processCode, name: file.name, size: file.size },
        'Drive file exceeds the ingestion size limit — skipped',
      );
      result.ignored.push({ name: file.name, reason: 'arquivo acima do limite de tamanho' });
      result.skipped += 1;
      continue;
    }

    let filePath: string | null = null;
    try {
      // Sheets nativo nao tem bytes: `alt=media` devolve erro e `files.export`
      // devolve o mesmo conteudo em xlsx.
      const buffer = file.nativo
        ? await googleDriveService.exportSpreadsheetAsXlsx(file.fileId)
        : await googleDriveService.downloadFileBuffer(file.fileId);

      // Native exports have no reliable size metadata; downloaded content
      // can also change after the listing. Check actual bytes before storage.
      if (buffer.length > maxFileBytes()) {
        result.ignored.push({
          name: file.name,
          reason: 'conteudo baixado acima do limite de tamanho',
        });
        result.skipped += 1;
        continue;
      }

      const contentSha256 = sha256(buffer);
      if (known.tombstoneShas.has(contentSha256)) {
        result.ignored.push({
          name: file.name,
          reason: 'conteudo identico a um documento excluido por um analista',
        });
        result.skipped += 1;
        continue;
      }
      // Mesmo conteudo ja no processo — arquivo copiado, pasta duplicada ou o
      // mesmo arquivo que a analista tinha subido a mao. Nao duplica e nao
      // gasta extracao de IA de novo.
      if (known.shas.has(contentSha256)) {
        result.skipped += 1;
        continue;
      }

      if (!(await isFileBufferTypeCompatible(file.name, file.mimeType, buffer))) {
        throw new Error(`Drive file content does not match its declared type: ${file.name}`);
      }

      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const safeName = `${Date.now()}-${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      filePath = path.join(UPLOAD_DIR, safeName);
      await fs.writeFile(filePath, buffer);

      const fakeFile = {
        originalname: file.name,
        path: filePath,
        mimetype: file.mimeType,
        size: buffer.length,
      } as Express.Multer.File;

      await documentService.upload(process.id, candidato.docType, fakeFile, null, {
        driveFileId: file.fileId,
        ingestionSource: 'drive',
        contentSha256,
        driveMd5: file.md5 ?? undefined,
        driveVersion: file.version ?? undefined,
        driveModifiedTime: file.modifiedTime ?? undefined,
        driveArea: candidato.area,
      });

      known.shas.add(contentSha256);
      known.versionByFileId.set(file.fileId, file.version);
      if (file.md5) known.md5s.add(file.md5);
      result.imported += 1;
      logger.info(
        {
          processCode: process.processCode,
          name: file.name,
          docType: candidato.docType,
          fileId: file.fileId,
          area: candidato.area,
          pasta: candidato.folderPath,
        },
        'Document ingested from the process Drive folder',
      );
    } catch (err) {
      result.failed += 1;
      if (filePath) await fs.unlink(filePath).catch(() => {});
      logger.error(
        { err, processCode: process.processCode, name: file.name, fileId: file.fileId },
        'Failed to ingest document from Drive',
      );
    }
  }

  return result;
}

// A varredura percorre todos os processos sequencialmente e pode passar dos 10
// minutos do cron. Sem esta trava, duas passadas concorreriam entre o SELECT de
// dedupe e o INSERT, e o mesmo arquivo do Drive entraria duas vezes — o
// `driveFileId` so protege depois de gravado. Mesmo padrao do `email-check`.
let sweepRunning = false;

/** Test seam — a trava e estado de modulo e vaza entre casos sem isto. */
export function __resetDriveSweepLock(): void {
  sweepRunning = false;
}

function registrarInativo(reason: string): DriveIngestionResult[] {
  const agora = new Date().toISOString();
  setDriveSweepStatus({
    startedAt: agora,
    finishedAt: agora,
    inactiveReason: reason,
    areas: { ...EMPTY_DRIVE_AREAS },
    totals: { processes: 0, imported: 0, skipped: 0, failed: 0 },
    orphanFolders: [],
    duplicatedFolders: [],
  });
  return [];
}

/**
 * Sweep every process that has a Drive folder. Intended for the scheduler.
 */
export async function ingestAllProcessesFromDrive(): Promise<DriveIngestionResult[]> {
  if (!isDriveIngestionEnabled()) {
    logger.debug('Drive ingestion disabled (DOCUMENT_SOURCE)');
    return registrarInativo(`Drive inativo: DOCUMENT_SOURCE=${process.env.DOCUMENT_SOURCE ?? ''}`);
  }
  if (sweepRunning) {
    logger.info('Drive ingestion sweep already running — skipping this tick');
    return [];
  }
  // Acquire before the first await: concurrent HTTP/job callers must not
  // both pass preflight and import the same snapshot. Finally covers failures.
  sweepRunning = true;
  const startedAt = new Date().toISOString();
  try {
    if (!(await googleDriveService.isRootConfigured())) {
      logger.warn(
        'DOCUMENT_SOURCE inclui drive mas GOOGLE_DRIVE_ROOT_FOLDER_ID nao esta configurado — nenhum documento sera lido do Drive',
      );
      return registrarInativo('GOOGLE_DRIVE_ROOT_FOLDER_ID ausente ou placeholder');
    }

    // The same Follow Up allow-list that governs process creation also governs
    // which process folders may feed documents. When it cannot be established,
    // importing nothing is safer and visible; falling back would re-authorize
    // stale/item-code processes.
    const referenceSource = getReferenceSource();
    const followUp = referenceSource === 'follow_up' ? await getFollowUpReferences() : null;
    if (referenceSource === 'follow_up' && !followUp) {
      logger.error('Follow Up allow-list unavailable — Drive ingestion sweep blocked');
      return registrarInativo('lista de referencias do Follow Up indisponivel');
    }

    const processes = await db
      .select({
        id: importProcesses.id,
        processCode: importProcesses.processCode,
        brand: importProcesses.brand,
      })
      .from(importProcesses)
      .where(isNotNull(importProcesses.processCode));

    // O indice reconhece um codigo pelo nome da pasta. A lista de referencias e
    // a do Follow Up (autoridade) mais os processos que ja existem no sistema —
    // assim uma pasta de processo conhecido nunca fica invisivel so porque a
    // planilha ficou para tras, e nome legado curto ('2080_SZ') nao casa nada.
    const referencias = new Set<string>(followUp ? followUp.byNormalized.keys() : []);
    for (const proc of processes) referencias.add(normalizeReference(proc.processCode));

    const index = await googleDriveService.buildProcessFolderIndex(referencias);

    const results: DriveIngestionResult[] = [];
    const codigosComProcesso = new Set<string>();
    for (const proc of processes) {
      const normalized = normalizeReference(proc.processCode);
      codigosComProcesso.add(normalized);
      if (followUp && !followUp.byNormalized.has(normalized)) {
        results.push({
          processId: proc.id,
          processCode: proc.processCode,
          imported: 0,
          skipped: 0,
          failed: 0,
          skippedReason: 'process not listed in Follow Up',
          folders: [],
          ignored: [],
        });
        continue;
      }
      try {
        results.push(await ingestProcessFromDrive(proc, index));
      } catch (err) {
        logger.error(
          { err, processCode: proc.processCode },
          'Drive ingestion failed for process — continuing with the rest',
        );
        results.push({
          processId: proc.id,
          processCode: proc.processCode,
          imported: 0,
          skipped: 0,
          failed: 1,
          folders: [],
          ignored: [],
        });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        imported: acc.imported + r.imported,
        skipped: acc.skipped + r.skipped,
        failed: acc.failed + r.failed,
      }),
      { imported: 0, skipped: 0, failed: 0 },
    );
    const semPasta = results.filter((r) => r.skippedReason).length;

    // Pasta de um codigo que a planilha conhece e o sistema ainda nao: so
    // alerta (D1). Criar processo a partir do nome de pasta nunca.
    const orphanFolders: DriveSweepStatus['orphanFolders'] = [];
    const duplicatedFolders: DriveSweepStatus['duplicatedFolders'] = [];
    for (const [code, pastas] of index.byCode) {
      if (!codigosComProcesso.has(code)) {
        orphanFolders.push({ code, paths: pastas.map((p) => p.path) });
      }
      if (pastas.length > 1) {
        duplicatedFolders.push({ code, paths: pastas.map((p) => p.path) });
      }
    }

    const finishedAt = new Date().toISOString();
    setDriveSweepStatus(
      {
        startedAt,
        finishedAt,
        areas: {
          pendentes: Boolean(index.areas.pendentes),
          espelhos: Boolean(index.areas.espelhos),
          imaginarium: Boolean(index.areas.imaginarium),
          puket: Boolean(index.areas.puket),
        },
        totals: { processes: results.length, ...totals },
        orphanFolders,
        duplicatedFolders,
      },
      results,
    );

    logger.info(
      {
        processes: results.length,
        semPasta,
        orfas: orphanFolders.length,
        duplicadas: duplicatedFolders.length,
        ...totals,
      },
      'Drive ingestion sweep finished',
    );

    return results;
  } finally {
    sweepRunning = false;
  }
}
