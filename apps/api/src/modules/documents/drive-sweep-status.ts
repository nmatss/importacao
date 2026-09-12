/**
 * Resultado da ultima varredura do Drive, em memoria (DRV-08).
 *
 * Mora num modulo proprio, sem banco nem cliente do Drive, porque quem LE isso
 * e a rota do processo e o `/health/integrations`: importar a ingestao inteira
 * so para ler um resumo puxaria a conexao de banco para dentro de um
 * controller.
 *
 * O que este arquivo resolve e o silencio do PK220 — "tinha tudo no Drive e o
 * sistema nao tinha nada". Ate aqui o resumo da varredura so existia no log:
 * nem a tela nem o health sabiam dizer se o Drive tinha olhado para o processo,
 * o que encontrou e por que deixou algo de fora.
 */

import type { DriveArea } from './drive-layout.js';

export interface DriveIgnoredFile {
  name: string;
  reason: string;
}

export interface DriveSweepFolder {
  area: DriveArea;
  path: string;
  folderId: string;
}

export interface DriveIngestionResult {
  processId: number;
  processCode: string;
  imported: number;
  skipped: number;
  failed: number;
  /** Motivo de o processo nao ter sido varrido, quando aplicavel. */
  skippedReason?: string;
  /** Pastas do Drive que alimentaram este processo nesta passada. */
  folders: DriveSweepFolder[];
  /** Arquivos deliberadamente nao importados, com o motivo em portugues. */
  ignored: DriveIgnoredFile[];
  /** Mais de um espelho valido para o mesmo codigo em 01. ESPELHOS. */
  espelhoAmbiguo?: boolean;
}

export interface DriveSweepStatus {
  startedAt: string;
  finishedAt: string | null;
  /** Motivo de a varredura nao ter rodado (Drive desligado, raiz ausente...). */
  inactiveReason?: string;
  areas: Record<DriveArea, boolean>;
  totals: { processes: number; imported: number; skipped: number; failed: number };
  /** Codigos com pasta no Drive e sem processo no sistema. */
  orphanFolders: Array<{ code: string; paths: string[] }>;
  /** Codigos com mais de uma pasta (ex.: PK2122607NB duplicada em PENDENTES). */
  duplicatedFolders: Array<{ code: string; paths: string[] }>;
}

export const EMPTY_DRIVE_AREAS: Record<DriveArea, boolean> = {
  pendentes: false,
  espelhos: false,
  imaginarium: false,
  puket: false,
};

let lastSweepStatus: DriveSweepStatus | null = null;
const lastResultByProcess = new Map<number, DriveIngestionResult & { checkedAt: string }>();

export function getDriveSweepStatus(): DriveSweepStatus | null {
  return lastSweepStatus;
}

export function setDriveSweepStatus(
  status: DriveSweepStatus,
  results: DriveIngestionResult[] = [],
): void {
  lastSweepStatus = status;
  if (!status.finishedAt) return;
  lastResultByProcess.clear();
  for (const result of results) {
    lastResultByProcess.set(result.processId, { ...result, checkedAt: status.finishedAt });
  }
}

/**
 * Status por processo para a tela do processo: responde "o Drive olhou para
 * este processo e o que encontrou".
 */
export function getDriveSweepStatusForProcess(processId: number): {
  sweep: DriveSweepStatus | null;
  process: (DriveIngestionResult & { checkedAt: string }) | null;
} {
  return { sweep: lastSweepStatus, process: lastResultByProcess.get(processId) ?? null };
}

/**
 * Ha quanto tempo a ultima varredura terminou, em minutos. `null` quando nunca
 * rodou nesta instancia.
 */
export function minutesSinceLastSweep(now: Date = new Date()): number | null {
  if (!lastSweepStatus?.finishedAt) return null;
  return Math.floor((now.getTime() - new Date(lastSweepStatus.finishedAt).getTime()) / 60_000);
}

/** Test seam — o status e estado de modulo e vaza entre casos sem isto. */
export function __resetDriveSweepStatus(): void {
  lastSweepStatus = null;
  lastResultByProcess.clear();
}
