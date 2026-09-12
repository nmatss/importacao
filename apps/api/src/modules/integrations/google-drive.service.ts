import { drive_v3, auth as googleAuth } from '@googleapis/drive';
import { eq } from 'drizzle-orm';
import { db } from '../../shared/database/connection.js';
import { importProcesses } from '../../shared/database/schema.js';
import { normalizeGooglePrivateKey } from '../../shared/utils/google-private-key.js';
import { logger } from '../../shared/utils/logger.js';
import { withRetry, withTimeout } from '../../shared/utils/resilience.js';
import { integrationRetryOptions } from './retry-policy.js';
import { resolveDriveWriteMode } from '../../shared/config/env.js';
import { getDocumentSource } from '../documents/source-policy.js';
import {
  FOLDER_MIME,
  GOOGLE_SHEET_MIME,
  XLSX_MIME,
  isYearFolderName,
  matchDriveArea,
  matchEspelhoFileName,
  matchProcessCodeInName,
  type DriveArea,
  type DriveProcessArea,
  type ReferenceLookup,
} from '../documents/drive-layout.js';

const DRIVE_API_TIMEOUT_MS = 30_000;

/**
 * Timeout de guarda das chamadas do Drive, agora com cancelamento REAL.
 *
 * A versao anterior era um `Promise.race` com `setTimeout`: a promessa perdedora
 * era descartada, mas a requisicao seguia em voo — o cliente do Google
 * continuava esperando a resposta, segurando socket e custo. `withTimeout` de
 * `shared/utils/resilience.ts` cria um `AbortController`, e os clientes
 * `@googleapis/*` aceitam `signal` por requisicao (MethodOptions estende
 * GaxiosOptions, que estende RequestInit), entao o abort chega ao fetch.
 */
function driveCall<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withTimeout(fn, DRIVE_API_TIMEOUT_MS, `Google Drive ${label}`);
}

/**
 * LEITURA: timeout com cancelamento + re-tentativa.
 *
 * So caminho de leitura entra aqui. Re-tentar `files.create` duplicaria pasta ou
 * arquivo no Drive quando a primeira chamada tivesse dado certo e so a resposta
 * se perdesse — e o upload ainda reusaria um ReadStream ja consumido. Por isso
 * as escritas usam `driveCall` puro, sem retry.
 */
function driveRead<T>(label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withRetry(() => driveCall(label, fn), integrationRetryOptions, `drive:${label}`);
}

let driveClient: drive_v3.Drive | null = null;

// Cache folder IDs to avoid duplicate creation: "parentId/folderName" -> folderId
// LRU-like cache with max size to prevent unbounded memory growth
const FOLDER_CACHE_MAX = 1000;
const folderCache = new Map<string, string>();
export const ROOT_FOLDER_PLACEHOLDERS = new Set(['your-root-folder-id']);

function getConfiguredRootFolderId(): string | null {
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim();
  if (!rootFolderId || ROOT_FOLDER_PLACEHOLDERS.has(rootFolderId)) return null;
  return rootFolderId;
}

function folderCacheSet(key: string, value: string): void {
  if (folderCache.size >= FOLDER_CACHE_MAX) {
    // Delete oldest entry (first key in Map iteration order)
    const firstKey = folderCache.keys().next().value;
    if (firstKey !== undefined) folderCache.delete(firstKey);
  }
  folderCache.set(key, value);
}

const SUBFOLDER_NAMES = ['Invoice', 'Packing List', 'BL', 'Espelho', 'Outros'] as const;

/** Numero que a API do Drive devolve como string; nao numerico vira `null`. */
function numeroDoDrive(valor: string | null | undefined): number | null {
  if (valor == null) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const DOC_TYPE_TO_SUBFOLDER: Record<string, string> = {
  invoice: 'Invoice',
  packing_list: 'Packing List',
  ohbl: 'BL',
  espelho: 'Espelho',
};

export interface DriveAreaFolder {
  id: string;
  name: string;
}

/** Areas da raiz PROCESSOS; `null` = area nao resolvida (vira aviso de health). */
export type DriveAreaMap = Record<DriveArea, DriveAreaFolder | null>;

export interface DriveProcessFolder {
  folderId: string;
  name: string;
  area: DriveProcessArea;
  /** Caminho legivel para o status do sweep, ex.: '03. PUKET/2027/HIGH SUMMER/PK2192607SZ'. */
  path: string;
  normalizedCode: string;
}

export interface DriveEspelhoFile {
  fileId: string;
  name: string;
  mimeType: string;
  /** Google Sheets nativo: precisa de `files.export`, nao tem md5. */
  nativo: boolean;
  md5: string | null;
  size: number | null;
  version: number | null;
  modifiedTime: string | null;
  normalizedCode: string;
}

export interface DriveUnknownFolder {
  name: string;
  path: string;
  area: DriveProcessArea;
}

export interface DriveProcessIndex {
  areas: DriveAreaMap;
  /** codigo normalizado -> TODAS as pastas dele (pastas duplicadas incluidas). */
  byCode: Map<string, DriveProcessFolder[]>;
  espelhosByCode: Map<string, DriveEspelhoFile[]>;
  unknownFolders: DriveUnknownFolder[];
  builtAt: Date;
}

/**
 * A integracao com PROCESSOS e SOMENTE LEITURA (D1/DRV-06).
 *
 * A pasta e o acervo da operacao, no Meu Drive de uma pessoa. Todo caminho de
 * escrita que existia (mover a pasta do processo para "PENDENTES DE CORREÇÃO",
 * criar 'Puket'/'Imaginarium'/'00. SISTEMA AUTOMATICO', subir copia de cada
 * documento) passaria a agir DENTRO desse acervo assim que a raiz apontasse
 * para ele. `DRIVE_WRITE_MODE` e a chave unica que separa leitura de escrita, e
 * o padrao ja e 'off' quando o Drive e fonte de documentos.
 */
export function isDriveWriteEnabled(): boolean {
  const explicit = process.env.DRIVE_WRITE_MODE?.trim();
  const mode = resolveDriveWriteMode(
    getDocumentSource(),
    explicit === 'off' || explicit === 'sistema' ? explicit : undefined,
  );
  return mode === 'sistema';
}

/**
 * Guarda unica das escritas. Devolve `false` (e loga) em vez de lancar: os
 * chamadores sao caminhos de background (fila, upload, validacao) e transformar
 * "modo somente leitura" em erro encheria o log de falhas que nao sao falhas.
 */
function writeBlocked(operacao: string, contexto: Record<string, unknown> = {}): boolean {
  if (isDriveWriteEnabled()) return false;
  logger.info(
    { operacao, ...contexto },
    'Escrita no Google Drive ignorada: DRIVE_WRITE_MODE=off (integracao somente leitura)',
  );
  return true;
}

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const privateKey = normalizeGooglePrivateKey(process.env.GOOGLE_DRIVE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive credentials not configured');
  }

  const auth = new googleAuth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    // Escopo minimo: com a escrita desligada o token nem consegue criar pasta,
    // entao um caminho de escrita esquecido falha no Google, nao no acervo.
    scopes: [
      isDriveWriteEnabled()
        ? 'https://www.googleapis.com/auth/drive'
        : 'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  driveClient = new drive_v3.Drive({ auth });
  return driveClient;
}

export const googleDriveService = {
  async createFolder(name: string, parentId?: string): Promise<string> {
    // Ponto mais baixo da escrita: aqui a guarda LANCA, porque quem chegou ate
    // aqui com a escrita desligada furou uma guarda de nivel acima e criar
    // pasta no acervo da operacao e irreversivel na pratica.
    if (!isDriveWriteEnabled()) {
      throw new Error('Escrita no Google Drive desativada (DRIVE_WRITE_MODE=off)');
    }
    const drive = getDriveClient();
    const rootFolderId = parentId || getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');

    const response = await driveCall(`createFolder(${name})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: rootFolderId ? [rootFolderId] : undefined,
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const folderId = response.data.id!;
    logger.info({ folderId, name }, 'Google Drive folder created');
    return folderId;
  },

  async uploadFile(filePath: string, fileName: string, folderId: string): Promise<string> {
    if (!isDriveWriteEnabled()) {
      throw new Error('Escrita no Google Drive desativada (DRIVE_WRITE_MODE=off)');
    }
    const drive = getDriveClient();
    const fs = await import('fs');

    const response = await driveCall(`uploadFile(${fileName})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [folderId],
          },
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: 'id, webViewLink',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, fileName }, 'File uploaded to Google Drive');
    return fileId;
  },

  getFileUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`;
  },

  async isConfigured(): Promise<boolean> {
    return !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY);
  },

  async isRootConfigured(): Promise<boolean> {
    return (await this.isConfigured()) && Boolean(getConfiguredRootFolderId());
  },

  /**
   * Read-only proof that the configured root exists, is a folder and is
   * accessible.
   *
   * DELIBERADAMENTE SEM RETRY: e sonda de health. Uma sonda que insiste tres
   * vezes mente sobre a latencia do ambiente e transforma `/health/integrations`
   * num endpoint de 90s quando o Drive esta inalcancavel. Aqui a primeira
   * resposta e a resposta.
   */
  async testRootAccess(): Promise<boolean> {
    const rootFolderId = getConfiguredRootFolderId();
    if (!(await this.isConfigured()) || !rootFolderId) return false;

    try {
      const drive = getDriveClient();
      const response = await driveCall('testRootAccess', (signal) =>
        drive.files.get(
          {
            fileId: rootFolderId,
            fields: 'id,mimeType,trashed',
            supportsAllDrives: true,
          },
          { signal },
        ),
      );
      return (
        response.data.mimeType === 'application/vnd.google-apps.folder' &&
        response.data.trashed !== true
      );
    } catch (error) {
      logger.warn({ err: error }, 'Configured Google Drive root is not accessible');
      return false;
    }
  },

  async findFolder(parentId: string, folderName: string): Promise<string | null> {
    const drive = getDriveClient();
    const response = await driveRead(`findFolder(${folderName})`, (signal) =>
      drive.files.list(
        {
          q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(folderName)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
          pageSize: 1,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
        { signal },
      ),
    );
    return response.data.files?.[0]?.id ?? null;
  },

  async listChildFolders(parentId: string): Promise<Array<{ id: string; name: string }>> {
    const drive = getDriveClient();
    const folders: Array<{ id: string; name: string }> = [];
    let pageToken: string | undefined;

    do {
      const response = await driveRead(`listChildFolders(${parentId})`, (signal) =>
        drive.files.list(
          {
            q: `'${escapeDriveQuery(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'nextPageToken, files(id, name)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
          { signal },
        ),
      );

      for (const folder of response.data.files ?? []) {
        if (folder.id && folder.name) folders.push({ id: folder.id, name: folder.name });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return folders;
  },

  async ensureFolder(parentId: string, folderName: string): Promise<string> {
    const cacheKey = `${parentId}/${folderName}`;
    const cached = folderCache.get(cacheKey);
    if (cached) return cached;

    const existing = await this.findFolder(parentId, folderName);
    if (existing) {
      folderCacheSet(cacheKey, existing);
      return existing;
    }

    const folderId = await this.createFolder(folderName, parentId);
    folderCacheSet(cacheKey, folderId);
    return folderId;
  },

  async ensureProcessFolder(
    processCode: string,
    brand: string,
  ): Promise<{ processFolderId: string; subfolders: Record<string, string> }> {
    if (!isDriveWriteEnabled()) {
      throw new Error('Escrita no Google Drive desativada (DRIVE_WRITE_MODE=off)');
    }
    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);
    const processFolderId = await this.ensureFolder(brandFolderId, processCode);

    const subfolders: Record<string, string> = {};
    for (const name of SUBFOLDER_NAMES) {
      subfolders[name] = await this.ensureFolder(processFolderId, name);
    }

    return { processFolderId, subfolders };
  },

  /**
   * INDICE de pastas por varredura (D1), no lugar da busca por processo.
   *
   * O finder antigo procurava `<raiz>/<Marca>/[Processo N ]<codigo>` e no maximo
   * um nivel abaixo da marca. Na arvore real a marca vem numerada ('03. PUKET'),
   * tem ano e as vezes colecao, e a pasta de entrada ('04. PENDENTES DE
   * CORREÇÃO') fica na RAIZ — nenhum caminho casava.
   *
   * Aqui a arvore e percorrida UMA vez por varredura e devolve todas as pastas
   * de cada codigo (inclusive as duplicadas, como PK2122607NB, que o `pageSize:
   * 1` do finder perdia de forma nao deterministica). Custo: 1 + areas + anos +
   * grupos chamadas por varredura, em vez de ~6 por processo.
   */
  async buildProcessFolderIndex(references: ReferenceLookup): Promise<DriveProcessIndex> {
    const areas = await this.resolveDriveAreas();
    const byCode = new Map<string, DriveProcessFolder[]>();
    const unknownFolders: DriveUnknownFolder[] = [];

    const registrar = (
      folder: { id: string; name: string },
      area: DriveProcessArea,
      parentPath: string,
    ): boolean => {
      const normalizedCode = matchProcessCodeInName(folder.name, references);
      if (!normalizedCode) return false;
      const lista = byCode.get(normalizedCode) ?? [];
      lista.push({
        folderId: folder.id,
        name: folder.name,
        area,
        path: `${parentPath}/${folder.name}`,
        normalizedCode,
      });
      byCode.set(normalizedCode, lista);
      return true;
    };

    // 04. PENDENTES DE CORREÇÃO — plana, filhos diretos sao pastas de processo.
    if (areas.pendentes) {
      const pendentes = await this.listChildFolders(areas.pendentes.id);
      for (const folder of pendentes) {
        if (!registrar(folder, 'pendentes', areas.pendentes.name)) {
          unknownFolders.push({
            name: folder.name,
            path: `${areas.pendentes.name}/${folder.name}`,
            area: 'pendentes',
          });
        }
      }
    }

    // 02. IMAGINARIUM / 03. PUKET — <ano>/[<grupo>/]<processo>. "Grupo" e
    // colecao (PUKET) ou faturamento (IMAGINARIUM, 'FAT 11', 'FAT - 08'): nao
    // ha lista fixa de nomes, o que decide e o codigo no inicio do nome.
    for (const area of ['imaginarium', 'puket'] as const) {
      const marca = areas[area];
      if (!marca) continue;
      const anos = await this.listChildFolders(marca.id);
      for (const ano of anos) {
        if (!isYearFolderName(ano.name)) {
          unknownFolders.push({
            name: ano.name,
            path: `${marca.name}/${ano.name}`,
            area,
          });
          continue;
        }
        const anoPath = `${marca.name}/${ano.name}`;
        const filhos = await this.listChildFolders(ano.id);
        for (const filho of filhos) {
          if (registrar(filho, area, anoPath)) continue;
          // Nao e processo: e grupo. Desce UM nivel, nunca mais.
          const grupoPath = `${anoPath}/${filho.name}`;
          const netos = await this.listChildFolders(filho.id);
          for (const neto of netos) {
            if (!registrar(neto, area, grupoPath)) {
              unknownFolders.push({ name: neto.name, path: `${grupoPath}/${neto.name}`, area });
            }
          }
        }
      }
    }

    const espelhosByCode = areas.espelhos
      ? await this.indexEspelhos(areas.espelhos.id, references)
      : new Map<string, DriveEspelhoFile[]>();

    return {
      areas,
      byCode,
      espelhosByCode,
      unknownFolders,
      builtAt: new Date(),
    };
  },

  /**
   * Resolve as 4 areas da raiz. O ID explicito (`GOOGLE_DRIVE_*_FOLDER_ID`)
   * vence; sem ele, o nome normalizado decide — a pasta real e acentuada
   * ("04. PENDENTES DE CORREÇÃO") e comparar literal quebraria no primeiro
   * rename. Area que nao resolve fica `null` e vira aviso de health, nunca
   * adivinhacao.
   */
  async resolveDriveAreas(): Promise<DriveAreaMap> {
    const areas: DriveAreaMap = {
      pendentes: null,
      espelhos: null,
      imaginarium: null,
      puket: null,
    };

    const rootFolderId = getConfiguredRootFolderId();
    if (rootFolderId) {
      for (const folder of await this.listChildFolders(rootFolderId)) {
        const area = matchDriveArea(folder.name);
        if (area && !areas[area]) areas[area] = { id: folder.id, name: folder.name };
      }
    }

    const overrides: Array<[DriveArea, string | undefined]> = [
      ['pendentes', process.env.GOOGLE_DRIVE_PENDENTES_FOLDER_ID?.trim()],
      ['espelhos', process.env.GOOGLE_DRIVE_ESPELHOS_FOLDER_ID?.trim()],
    ];
    for (const [area, id] of overrides) {
      if (id) areas[area] = { id, name: areas[area]?.name ?? area };
    }

    return areas;
  },

  /**
   * 01. ESPELHOS e plana e tem os dois formatos: Sheets NATIVO (a maioria) e
   * .xlsx binario. O casamento e por codigo no inicio do nome, com exclusao
   * explicita de 'CONSOLIDADO' e '(antigo com erro)'.
   */
  async indexEspelhos(
    folderId: string,
    references: ReferenceLookup,
  ): Promise<Map<string, DriveEspelhoFile[]>> {
    const porCodigo = new Map<string, DriveEspelhoFile[]>();

    for (const file of await this.listFolderEntries(folderId)) {
      if (!file.id || !file.name) continue;
      if (file.mimeType === FOLDER_MIME) continue;
      const nativo = file.mimeType === GOOGLE_SHEET_MIME;
      if (!nativo && !/\.(xlsx|xls)$/i.test(file.name)) continue;

      const normalizedCode = matchEspelhoFileName(file.name, references);
      if (!normalizedCode) continue;

      const lista = porCodigo.get(normalizedCode) ?? [];
      lista.push({
        fileId: file.id,
        name: file.name,
        mimeType: file.mimeType ?? XLSX_MIME,
        nativo,
        md5: file.md5Checksum ?? null,
        size: numeroDoDrive(file.size),
        version: numeroDoDrive(file.version),
        modifiedTime: file.modifiedTime ?? null,
        normalizedCode,
      });
      porCodigo.set(normalizedCode, lista);
    }

    // Mais recente primeiro: com mais de um espelho valido para o mesmo codigo,
    // a ingestao usa o primeiro e reporta ambiguidade.
    for (const lista of porCodigo.values()) {
      lista.sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
    }

    return porCodigo;
  },

  async uploadToProcessFolder(
    processCode: string,
    brand: string,
    documentType: string,
    filePath: string,
    fileName: string,
  ): Promise<string | null> {
    if (writeBlocked('uploadToProcessFolder', { processCode, documentType })) return null;

    const { processFolderId, subfolders } = await this.ensureProcessFolder(processCode, brand);
    const subfolderName = DOC_TYPE_TO_SUBFOLDER[documentType] || 'Outros';
    const targetFolderId = subfolders[subfolderName];

    const driveFileId = await this.uploadFile(filePath, fileName, targetFolderId);

    // Update process driveFolderId if not set yet
    const [process] = await db
      .select({ driveFolderId: importProcesses.driveFolderId })
      .from(importProcesses)
      .where(eq(importProcesses.processCode, processCode))
      .limit(1);

    if (process && !process.driveFolderId) {
      await db
        .update(importProcesses)
        .set({ driveFolderId: processFolderId, updatedAt: new Date() })
        .where(eq(importProcesses.processCode, processCode));
    }

    logger.info(
      { processCode, documentType, driveFileId, subfolderName },
      'File uploaded to process folder',
    );
    return driveFileId;
  },

  async moveToCorrection(processCode: string, brand: string): Promise<void> {
    if (writeBlocked('moveToCorrection', { processCode })) return;
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) return;

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);

    // Find the process folder
    const processFolderId = await this.findFolder(brandFolderId, processCode);
    if (!processFolderId) {
      logger.warn({ processCode }, 'Process folder not found for correction move');
      return;
    }

    // Create/ensure correction folder under brand
    const correctionFolderId = await this.ensureFolder(brandFolderId, 'PENDENTES DE CORREÇÃO');

    // Move process folder: remove from brand, add to correction
    const drive = getDriveClient();
    await driveCall(`moveToCorrection(${processCode})`, (signal) =>
      drive.files.update(
        {
          fileId: processFolderId,
          addParents: correctionFolderId,
          removeParents: brandFolderId,
          fields: 'id, parents',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    logger.info({ processCode, correctionFolderId }, 'Process moved to correction folder');
  },

  async moveFromCorrection(processCode: string, brand: string): Promise<void> {
    if (writeBlocked('moveFromCorrection', { processCode })) return;
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) return;

    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
    const brandFolderId = await this.ensureFolder(rootFolderId, brandName);

    // Find correction folder
    const correctionFolderId = await this.findFolder(brandFolderId, 'PENDENTES DE CORREÇÃO');
    if (!correctionFolderId) return;

    // Find process folder inside correction
    const processFolderId = await this.findFolder(correctionFolderId, processCode);
    if (!processFolderId) {
      logger.warn({ processCode }, 'Process folder not found in correction folder');
      return;
    }

    // Move back: remove from correction, add to brand
    const drive = getDriveClient();
    await driveCall(`moveFromCorrection(${processCode})`, (signal) =>
      drive.files.update(
        {
          fileId: processFolderId,
          addParents: brandFolderId,
          removeParents: correctionFolderId,
          fields: 'id, parents',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    logger.info({ processCode }, 'Process moved from correction back to brand folder');
  },

  // ── Sistema Automatico methods ──────────────────────────────────────

  async ensureSistemaFolder(): Promise<string> {
    if (!isDriveWriteEnabled()) {
      throw new Error('Escrita no Google Drive desativada (DRIVE_WRITE_MODE=off)');
    }
    const rootFolderId = getConfiguredRootFolderId();
    if (!rootFolderId) throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID not configured');
    return this.ensureFolder(rootFolderId, '00. SISTEMA AUTOMATICO');
  },

  async ensureSistemaInbox(): Promise<string> {
    const sistemaId = await this.ensureSistemaFolder();
    return this.ensureFolder(sistemaId, 'INBOX');
  },

  async ensureSistemaProcessFolder(processCode: string): Promise<Record<string, string>> {
    const sistemaId = await this.ensureSistemaFolder();
    const processadosId = await this.ensureFolder(sistemaId, 'PROCESSADOS');
    const processFolderId = await this.ensureFolder(processadosId, processCode);

    // Store sistemaDriveFolderId back to importProcesses
    try {
      await db
        .update(importProcesses)
        .set({ sistemaDriveFolderId: processFolderId, updatedAt: new Date() })
        .where(eq(importProcesses.processCode, processCode));
    } catch (err) {
      logger.warn({ err, processCode }, 'Failed to store sistemaDriveFolderId');
    }

    const subfolders: Record<string, string> = {};
    for (const name of ['Invoice', 'Packing List', 'BL', 'Relatorio de Validacao']) {
      subfolders[name] = await this.ensureFolder(processFolderId, name);
    }
    return subfolders;
  },

  async uploadToSistemaInbox(filePath: string, fileName: string): Promise<string | null> {
    if (writeBlocked('uploadToSistemaInbox', { fileName })) return null;
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');
    const inboxId = await this.ensureSistemaInbox();
    return this.uploadFile(filePath, fileName, inboxId);
  },

  async moveFromInboxToProcessados(
    fileId: string,
    processCode: string,
    docType: string,
  ): Promise<void> {
    if (writeBlocked('moveFromInboxToProcessados', { processCode })) return;
    const configured = await this.isRootConfigured();
    if (!configured) return;

    const subfolders = await this.ensureSistemaProcessFolder(processCode);
    const docTypeMap: Record<string, string> = {
      invoice: 'Invoice',
      packing_list: 'Packing List',
      ohbl: 'BL',
    };
    const targetFolder = subfolders[docTypeMap[docType] || 'Invoice'];
    if (!targetFolder) return;

    const inboxId = await this.ensureSistemaInbox();
    const drive = getDriveClient();

    try {
      await driveCall(`moveFromInboxToProcessados(${processCode})`, (signal) =>
        drive.files.update(
          {
            fileId,
            addParents: targetFolder,
            removeParents: inboxId,
            fields: 'id, parents',
            supportsAllDrives: true,
          },
          { signal },
        ),
      );
      logger.info({ fileId, processCode, docType }, 'File moved from INBOX to PROCESSADOS');
    } catch (err: any) {
      if (err?.code === 404) {
        logger.warn({ fileId, processCode }, 'File not found in INBOX, skipping move');
        return;
      }
      throw err;
    }
  },

  async uploadValidationReport(
    processCode: string,
    reportData: Record<string, any>,
  ): Promise<string | null> {
    if (writeBlocked('uploadValidationReport', { processCode })) return null;
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const subfolders = await this.ensureSistemaProcessFolder(processCode);
    const reportFolderId = subfolders['Relatorio de Validacao'];

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const content = JSON.stringify(reportData, null, 2);
    const fileName = `validacao_${processCode}_${new Date().toISOString().slice(0, 10)}.json`;

    const response = await driveCall(`uploadValidationReport(${processCode})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [reportFolderId],
            mimeType: 'application/json',
          },
          media: {
            mimeType: 'application/json',
            body: Readable.from(content),
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, processCode }, 'Validation report uploaded to Sistema Automatico');
    return fileId;
  },

  async uploadToAlertas(fileName: string, content: string): Promise<string | null> {
    if (writeBlocked('uploadToAlertas', { fileName })) return null;
    const configured = await this.isRootConfigured();
    if (!configured) throw new Error('Google Drive not configured');

    const sistemaId = await this.ensureSistemaFolder();
    const alertasId = await this.ensureFolder(sistemaId, 'ALERTAS');

    const drive = getDriveClient();
    const { Readable } = await import('stream');

    const response = await driveCall(`uploadToAlertas(${fileName})`, (signal) =>
      drive.files.create(
        {
          requestBody: {
            name: fileName,
            parents: [alertasId],
            mimeType: 'application/json',
          },
          media: {
            mimeType: 'application/json',
            body: Readable.from(content),
          },
          fields: 'id',
          supportsAllDrives: true,
        },
        { signal },
      ),
    );

    const fileId = response.data.id!;
    logger.info({ fileId, fileName }, 'Alert uploaded to ALERTAS folder');
    return fileId;
  },

  /**
   * Find the most-recently-modified xlsx with "pre-cons"/"precons" in the
   * name inside the configured folder. Folder ID comes from
   * GOOGLE_DRIVE_PRE_CONS_FOLDER_ID. Returns null when nothing matches.
   */
  async findLatestPreConsXlsx(): Promise<{
    id: string;
    name: string;
    modifiedTime: string | null;
  } | null> {
    const folderId = process.env.GOOGLE_DRIVE_PRE_CONS_FOLDER_ID;
    if (!folderId) return null;
    const drive = getDriveClient();
    const response = await driveRead('findLatestPreConsXlsx', (signal) =>
      drive.files.list(
        {
          q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false and (mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel')`,
          fields: 'files(id, name, modifiedTime, mimeType)',
          orderBy: 'modifiedTime desc',
          pageSize: 25,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
        { signal },
      ),
    );
    const candidates = (response.data.files ?? []).filter((f) => /pre.?cons/i.test(f.name ?? ''));
    const best = candidates[0] ?? response.data.files?.[0];
    if (!best?.id) return null;
    return {
      id: best.id,
      name: best.name ?? 'pre-cons.xlsx',
      modifiedTime: best.modifiedTime ?? null,
    };
  },

  async downloadFileBuffer(fileId: string): Promise<Buffer> {
    const drive = getDriveClient();
    const response = await driveRead(`downloadFileBuffer(${fileId})`, (signal) =>
      drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer', signal },
      ),
    );
    return Buffer.from(response.data as ArrayBuffer);
  },

  /**
   * Varredura RECURSIVA de uma pasta (usada pela tela de diagnostico do Drive e
   * pelo anexo de comunicacao). A ingestao NAO usa mais este metodo: dentro da
   * pasta do processo ela precisa decidir onde descer (nunca em 'Backup').
   */
  async listProcessFiles(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();
    const allFiles: drive_v3.Schema$File[] = [];

    async function listRecursive(parentId: string) {
      let pageToken: string | undefined;
      do {
        const response = await driveRead(`listProcessFiles(${parentId})`, (signal) =>
          drive.files.list(
            {
              q: `'${escapeDriveQuery(parentId)}' in parents and trashed = false`,
              fields: 'nextPageToken, files(id, name, mimeType, size, webViewLink, createdTime)',
              pageSize: 100,
              pageToken,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            },
            { signal },
          ),
        );

        for (const file of response.data.files || []) {
          allFiles.push(file);
          if (file.mimeType === 'application/vnd.google-apps.folder' && file.id) {
            await listRecursive(file.id);
          }
        }
        pageToken = response.data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    await listRecursive(folderId);
    return allFiles;
  },

  /**
   * Filhos DIRETOS de uma pasta (arquivos e subpastas), com os campos que a
   * dedupe por conteudo e versao exige: `md5Checksum` (binarios), `version` e
   * `modifiedTime` (Sheets nativos, que nao tem md5).
   *
   * Nao e recursiva de proposito: quem decide onde descer e a ingestao, que
   * conhece as regras de subpasta (nunca em 'Backup', so nas subpastas de tipo
   * do layout antigo do proprio sistema).
   */
  async listFolderEntries(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();
    const entries: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;

    do {
      const response = await driveRead(`listFolderEntries(${folderId})`, (signal) =>
        drive.files.list(
          {
            q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false`,
            fields:
              'nextPageToken, files(id, name, mimeType, size, md5Checksum, version, modifiedTime, createdTime, webViewLink)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          },
          { signal },
        ),
      );

      for (const file of response.data.files ?? []) entries.push(file);
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return entries;
  },

  /**
   * Espelho em Google Sheets NATIVO nao tem bytes para baixar: `alt=media`
   * responde erro. `files.export` devolve o mesmo conteudo em xlsx, que e o
   * formato que o `processEspelho` ja sabe ler.
   */
  async exportSpreadsheetAsXlsx(fileId: string): Promise<Buffer> {
    const drive = getDriveClient();
    const response = await driveRead(`exportSpreadsheetAsXlsx(${fileId})`, (signal) =>
      drive.files.export({ fileId, mimeType: XLSX_MIME }, { responseType: 'arraybuffer', signal }),
    );
    return Buffer.from(response.data as ArrayBuffer);
  },
};
