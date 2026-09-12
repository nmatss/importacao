/**
 * Regras PURAS do layout da pasta PROCESSOS (reuniao 11/09/2026, decisao D1).
 *
 * A arvore real, lida pela conta de servico em 11/09, nao e a que o finder
 * antigo esperava (`<raiz>/<Marca>/Importado/Processo N <codigo>`):
 *
 *   PROCESSOS/
 *     01. ESPELHOS/                      <- planos: Sheets nativos E .xlsx
 *     02. IMAGINARIUM/<ano>/FAT <mes>/<processo>
 *     03. PUKET/<ano>/[<colecao>/]<processo>
 *     04. PENDENTES DE CORRECAO/<processo>
 *
 * Nada aqui faz I/O: sao as decisoes de nome que precisam de teste tabelado
 * contra o gabarito real (acentos, prefixo numerico, espaco no fim, sufixo
 * depois do codigo, grafias de FAT, nomes legados curtos).
 */

import path from 'path';
import { normalizeReference } from '../follow-up/reference-registry.js';
import { classifyDocument } from '../email-ingestion/classify-document.js';

/** Area da raiz PROCESSOS de onde um arquivo veio. */
export type DriveArea = 'pendentes' | 'espelhos' | 'imaginarium' | 'puket';

/** Areas que contem pastas de processo (a de espelhos e plana). */
export type DriveProcessArea = Exclude<DriveArea, 'espelhos'>;

/** Consulta de referencias validas (Follow Up + processos do banco). */
export interface ReferenceLookup {
  has(normalizedReference: string): boolean;
}

export const SUPPORTED_DRIVE_EXTENSIONS = new Set([
  '.pdf',
  '.xlsx',
  '.xls',
  '.csv',
  '.docx',
  '.doc',
  '.png',
  '.jpg',
  '.jpeg',
]);

export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Caixa alta, sem acento e sem espaco duplicado. A pasta real e
 * "04. PENDENTES DE CORREÇÃO" (com Ç e Ã); comparar por string literal
 * acentuada seria uma armadilha na primeira vez que alguem renomear.
 */
export function normalizeFolderName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Reconhece as 4 areas da raiz, com o prefixo numerico opcional. */
export function matchDriveArea(name: string): DriveArea | null {
  const normalized = normalizeFolderName(name).replace(/^\d+\s*\.\s*/, '');
  if (normalized === 'PENDENTES DE CORRECAO') return 'pendentes';
  if (normalized === 'ESPELHOS') return 'espelhos';
  if (normalized === 'IMAGINARIUM') return 'imaginarium';
  if (normalized === 'PUKET') return 'puket';
  return null;
}

export function isYearFolderName(name: string): boolean {
  return /^20\d{2}$/.test(name.trim());
}

/**
 * Codigo de processo quando o nome da pasta COMECA com um codigo conhecido.
 *
 * Regra do gabarito: apos o trim, o codigo tem de terminar no fim do nome ou
 * num separador nao alfanumerico. Vence o prefixo MAIS LONGO que a lista de
 * referencias reconhece, porque o proprio codigo pode ter hifens
 * ('PKT-0032-BD-SEA'). Nomes legados curtos ('2080_SZ', '2066_SZB') nao estao
 * na lista e por isso nao casam — e exatamente o que se quer deles.
 */
export function matchProcessCodeInName(name: string, references: ReferenceLookup): string | null {
  const trimmed = name.trim();
  let best: string | null = null;

  for (let i = 1; i <= trimmed.length; i += 1) {
    const atEnd = i === trimmed.length;
    // Fronteira: fim do nome ou proximo caractere nao alfanumerico.
    if (!atEnd && /[A-Za-z0-9]/.test(trimmed[i]!)) continue;
    const prefix = trimmed.slice(0, i);
    // O prefixo tem de terminar em caractere util; "PK2192607SZ -" e o mesmo
    // codigo, mas "PK2192607SZ - " nao acrescenta nada.
    if (!/[A-Za-z0-9]$/.test(prefix)) continue;
    const normalized = normalizeReference(prefix);
    if (normalized.length < 5) continue;
    if (references.has(normalized)) best = normalized;
  }

  return best;
}

/**
 * O nome do arquivo cita o codigo do processo em qualquer posicao?
 *
 * Serve para separar 'KIOM INV - PK2192607SZ.pdf' (documento do processo) de
 * '2026.09.10 - FATURA2103.pdf' (fatura do transportador que mora na mesma
 * pasta). Usa a mesma normalizacao das referencias, entao 'PKT-0032-BD-SEA' e
 * 'PKT0032BDSEA' sao a mesma citacao.
 */
export function nameReferencesCode(name: string, normalizedCode: string): boolean {
  if (!normalizedCode) return false;
  return normalizeReference(name).includes(normalizedCode);
}

const ESPELHO_EXCLUSION = /\b(CONSOLIDADO|ANTIGO|ANTIGA|ERRO|ERRADO|BACKUP)\b/;

/**
 * Espelho da pasta "01. ESPELHOS": '<codigo> - Espelho' e variacoes.
 *
 * Exclui deliberadamente 'ESPELHO CONSOLIDADO PUKET/IMAGINARIUM' (planilha de
 * muitos processos) e '<codigo> (antigo com erro) - Espelho'. Nome que nao
 * resolve para um codigo conhecido nao vira espelho de ninguem.
 */
export function matchEspelhoFileName(name: string, references: ReferenceLookup): string | null {
  const semExtensao = name.replace(/\.(xlsx|xls|csv)$/i, '');
  const normalized = normalizeFolderName(semExtensao);
  if (!/\bESPELHO\b/.test(normalized)) return null;
  if (ESPELHO_EXCLUSION.test(normalized)) return null;

  const antesDoEspelho = semExtensao.slice(0, semExtensao.toUpperCase().indexOf('ESPELHO'));
  if (!antesDoEspelho.trim()) return null;

  return matchProcessCodeInName(antesDoEspelho, references);
}

/**
 * Subpasta de versao anterior DENTRO da pasta do processo.
 *
 * O gabarito tem `PK2202608SZ/Backup/` com uma invoice ANTIGA: descer ali
 * importaria duas invoices do mesmo processo e o seletor "mais recente" do
 * comparativo poderia pegar a errada.
 */
export function isVersionamentoSubfolder(name: string): boolean {
  const normalized = normalizeFolderName(name);
  return /\b(BACKUP|BKP|ANTIGO|ANTIGA|ANTIGOS|ANTIGAS|OLD|VERSAO ANTERIOR|VERSOES)\b/.test(
    normalized,
  );
}

/**
 * Subpastas por tipo criadas pelo PROPRIO sistema no layout antigo. So nelas a
 * varredura desce dentro da pasta do processo.
 */
const TYPE_SUBFOLDERS = new Set([
  'INVOICE',
  'PACKING LIST',
  'BL',
  'ESPELHO',
  'OUTROS',
  'RELATORIO DE VALIDACAO',
]);

export function isTypeSubfolder(name: string): boolean {
  return TYPE_SUBFOLDERS.has(normalizeFolderName(name));
}

/**
 * Arquivo que existe na pasta mas NAO e documento do fluxo de importacao.
 *
 * Na pasta real do PK2202608SZ convivem CT-e, manifesto e a fatura do
 * transportador ('2026.09.10 - FATURA2103.pdf', 'fat_138902_73839.pdf'). Sem
 * esta regra a fatura do frete entraria como `invoice` (o classificador casa
 * 'fatura') e contaminaria o comparativo, e o resto abriria um alerta de
 * operador por arquivo na primeira varredura.
 *
 * A guarda vale SO para a varredura do Drive: o upload manual continua podendo
 * classificar o que a analista quiser.
 */
export function isArquivoForaDoFluxo(name: string): boolean {
  const normalized = normalizeFolderName(name);
  if (/\bCT-?E\b/.test(normalized)) return true;
  if (/\bMANI[FS]TESTO\b/.test(normalized)) return true;
  if (/^FAT[_\s-]*\d/.test(normalized)) return true;
  // 'FATURA2103' / 'FATURA 2103' — fatura nacional numerada. A invoice do
  // fornecedor chega como 'INVOICE'/'KIOM INV'/'COMMERCIAL', nunca assim.
  if (/\bFATURA\s*\d/.test(normalized)) return true;
  return false;
}

export interface DriveFileDecision {
  /** Tipo de documento quando o arquivo entra. */
  docType?: string;
  /** Motivo em portugues quando o arquivo e ignorado (vai para o status). */
  ignoredReason?: string;
}

/**
 * Decide o que a varredura faz com um arquivo da pasta do processo.
 *
 * Diferenca deliberada em relacao ao e-mail: nome que o classificador nao
 * reconhece NAO vira documento `other`. A pasta do time tem arquivos que nao
 * sao do fluxo, e cada `other` gera um alerta de operador.
 */
export function classifyDriveFile(
  name: string,
  options: { hasKnownProcessCode?: boolean } = {},
): DriveFileDecision {
  const extensao = path.extname(name).toLowerCase();
  if (!SUPPORTED_DRIVE_EXTENSIONS.has(extensao)) {
    return { ignoredReason: 'extensao nao suportada' };
  }
  if (!options.hasKnownProcessCode && isArquivoForaDoFluxo(name)) {
    return { ignoredReason: 'arquivo fora do fluxo (CT-e, manifesto ou fatura de transporte)' };
  }
  const docType = classifyDocument(name);
  if (docType === 'other') {
    return { ignoredReason: 'tipo de documento nao reconhecido pelo nome' };
  }
  if (docType === 'espelho') {
    // Espelho so vale o da pasta 01. ESPELHOS (D1). Uma copia solta na pasta do
    // processo nao pode disputar com a planilha oficial.
    return { ignoredReason: 'espelho so e lido de 01. ESPELHOS' };
  }
  return { docType };
}

export interface DriveCandidate<T> {
  area: DriveProcessArea;
  docType: string;
  file: T;
}

/**
 * Prioridade POR TIPO (D1): para cada tipo de documento, o que estiver em
 * '04. PENDENTES DE CORRECAO' vence; os tipos que PENDENTES nao tem vem da
 * pasta da marca. A regra literal ("se PENDENTES tem algo, ignore a marca")
 * perderia o BL que so existe na pasta da marca.
 */
export function selectByDocumentTypePriority<T>(
  candidates: Array<DriveCandidate<T>>,
): Array<DriveCandidate<T>> {
  const tiposComPendentes = new Set(
    candidates.filter((c) => c.area === 'pendentes').map((c) => c.docType),
  );
  return candidates.filter((c) => c.area === 'pendentes' || !tiposComPendentes.has(c.docType));
}
