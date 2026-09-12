import {
  ArrowLeft,
  Edit,
  ExternalLink,
  AlertTriangle,
  BadgeCheck,
  Lock,
  Unlock,
  Save,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn, formatDate } from '@/shared/lib/utils';
import { useAuth } from '@/shared/hooks/useAuth';
import { StatusBadge } from '@/shared/components/StatusBadge';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { api } from '@/shared/lib/api-client';
import { correctionStatusLabel } from '@/shared/lib/constants';
import { getErrorMessage } from '@/shared/utils/errors';
import type { ImportProcess } from '@/shared/types';

import { isDocumentOperational } from '@/shared/lib/confidence';

export interface ProcessHeaderProps {
  process: ImportProcess;
  processId: string;
  onBack: () => void;
  onEdit: () => void;
}

/** Chip de 20px usado por marca, flags e avisos — tudo cabe na mesma linha. */
const CHIP =
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap';

function ProcessFlags({ process }: { process: ImportProcess }) {
  const flags = [
    {
      active: process.hasLiItems,
      label: 'LI',
      color:
        'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700',
    },
    {
      active: process.hasCertification,
      label: 'Certificacao',
      color:
        'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-700',
    },
    {
      active: process.hasFreeOfCharge,
      label: 'FOC',
      color:
        'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
    },
  ].filter((f) => f.active);

  if (flags.length === 0) return null;

  return (
    <>
      {flags.map((f) => (
        <span key={f.label} className={cn(CHIP, f.color)}>
          <BadgeCheck className="h-3 w-3" />
          {f.label}
        </span>
      ))}
    </>
  );
}

function hasUsefulExtraction(doc: ImportProcess['documents'][number]) {
  const data = doc.aiParsedData;
  if (!doc.isProcessed || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.extractionFailed || data.error || data.skipped) return false;
  if (!isDocumentOperational(doc.confidenceScore, doc.type ?? '')) return false;

  const metaKeys = new Set([
    'budgetExceeded',
    'confidence',
    'confidenceScore',
    'error',
    'extractionFailed',
    'fieldsWithLowConfidence',
    'reason',
    'rawText',
    'skipped',
    'source',
    '_trust',
    'warnings',
  ]);

  const hasValue = (value: unknown): boolean => {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value === true;
    if (Array.isArray(value)) return value.some((item) => hasValue(item));
    if (typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if ('value' in record) return hasValue(record.value);
    return Object.entries(record).some(([key, nested]) => !metaKeys.has(key) && hasValue(nested));
  };

  return hasValue(data);
}

/**
 * Read a date field from the BL espelho summary projected by the backend
 * (process.aiExtractedData.espelho.summary.{etd,eta}). Used as a subtle
 * fallback for the header subtitle — same source the info card relies on.
 */
function readEspelhoSummaryDate(process: ImportProcess, key: 'etd' | 'eta'): string | null {
  const aiData = process.aiExtractedData;
  if (!aiData || typeof aiData !== 'object' || Array.isArray(aiData)) return null;
  const espelho = (aiData as Record<string, unknown>).espelho;
  if (!espelho || typeof espelho !== 'object' || Array.isArray(espelho)) return null;
  const summary = (espelho as Record<string, unknown>).summary;
  const source =
    summary && typeof summary === 'object' && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : (espelho as Record<string, unknown>);
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Barra fixa do processo — UMA linha no desktop (reuniao 11/09: "criado, ETD,
 * ETA do lado da referencia; tudo pequeno e numa linha; quanto menor ali,
 * melhor"; a usuaria digitou na propria observacao "precisamos diminuir essa
 * telinha aqui urgent").
 *
 * O que mudou em relacao ao layout anterior, que empilhava cinco faixas:
 * - identificacao, datas, contagem de documentos e flags (LI/Certificacao/FOC)
 *   entram na MESMA linha, como chips de 11px;
 * - a observacao urgente virou um campo de uma linha no meio da barra, salvo
 *   com Enter ou pelo botao de disquete, em vez de um `textarea` de 42px+ com
 *   um botao "Salvar" embaixo;
 * - Drive, Sistema, Editar e Destravar viraram botoes so de icone (32px). O
 *   texto continua acessivel por `aria-label`/`title`, que sao os mesmos de
 *   antes — os testes e o leitor de tela nao perdem nada.
 *
 * Abaixo de `lg` a barra nao e fixa (correcao de 06/09: em 375px ela ocupava
 * 537px de 812px) e o conteudo quebra em varias linhas normalmente.
 */
export function ProcessHeader({ process, processId, onBack, onEdit }: ProcessHeaderProps) {
  const docCounts = {
    total: process.documents?.length ?? 0,
    extracted: process.documents?.filter(hasUsefulExtraction).length ?? 0,
  };
  const etd = process.etd ?? readEspelhoSummaryDate(process, 'etd');
  const eta = process.etaActual ?? process.eta ?? readEspelhoSummaryDate(process, 'eta');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // `/unlock` e admin-only no backend; o botao era exibido para todos e so
  // falhava com 403 depois do clique e da confirmacao.
  const canUnlock = user?.role === 'admin';
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [urgentNote, setUrgentNote] = useState(process.urgentNote ?? '');
  const [savingUrgentNote, setSavingUrgentNote] = useState(false);
  const urgentNoteChanged = urgentNote !== (process.urgentNote ?? '');

  useEffect(() => {
    setUrgentNote(process.urgentNote ?? '');
  }, [process.urgentNote]);

  const handleUnlock = async () => {
    setShowUnlockConfirm(false);
    try {
      // Via api-client: o `fetch` cru contornava o redirecionamento de sessao
      // expirada (401) e trocava a mensagem real do backend por "Falha ao
      // destravar (403)".
      await api.post(`/api/processes/${processId}/unlock`);
      toast.success('Processo destravado');
      queryClient.invalidateQueries({ queryKey: ['process', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const saveUrgentNote = async () => {
    if (savingUrgentNote || !urgentNoteChanged) return;
    setSavingUrgentNote(true);
    try {
      await api.put(`/api/processes/${processId}`, { urgentNote: urgentNote.trim() || null });
      toast.success('Observacao urgente salva');
      queryClient.invalidateQueries({ queryKey: ['process', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSavingUrgentNote(false);
    }
  };

  const iconButton =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors shadow-sm';

  return (
    <>
      <div
        data-testid="process-header-bar"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:flex-nowrap"
      >
        {/* Identificacao + datas + documentos + flags: tudo numa linha */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            onClick={onBack}
            className={cn(
              iconButton,
              'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
            aria-label="Voltar para lista de processos"
            title="Voltar para lista de processos"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <h2 className="truncate text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-lg">
            {process.processCode}
          </h2>

          <span
            className={cn(
              CHIP,
              'border-slate-200 bg-slate-100 capitalize text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
            )}
          >
            {process.brand}
          </span>

          <StatusBadge status={process.status} size="sm" />

          {process.correctionStatus && (
            <span
              className={cn(
                CHIP,
                'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {correctionStatusLabel(process.correctionStatus)}
            </span>
          )}

          {process.lockedAt && (
            <span
              className={cn(
                CHIP,
                'border-slate-300 bg-slate-200 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300',
              )}
              title={`Travado em ${formatDate(process.lockedAt)} (${process.lockedReason ?? 'sem motivo'})`}
            >
              <Lock className="h-3 w-3" />
              Travado
            </span>
          )}

          <ProcessFlags process={process} />

          {process.previousCodes && process.previousCodes.length > 0 && (
            <span
              className={cn(
                CHIP,
                'border-slate-200 bg-slate-100 font-mono text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400',
              )}
              title={`Códigos anteriores: ${process.previousCodes.join(', ')}`}
            >
              ex.: {process.previousCodes[process.previousCodes.length - 1]}
            </span>
          )}

          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400 sm:text-xs">
            <span>Criado {formatDate(process.createdAt)}</span>
            {etd && (
              <span>
                · ETD{' '}
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  {formatDate(etd)}
                </span>
              </span>
            )}
            {eta && (
              <span>
                · ETA {process.etaActual ? 'realizado' : 'previsto'}{' '}
                <span className="font-medium text-slate-600 dark:text-slate-400">
                  {formatDate(eta)}
                </span>
              </span>
            )}
            <span>
              · {docCounts.total} doc{docCounts.total !== 1 ? 's' : ''} ({docCounts.extracted}{' '}
              extraido{docCounts.extracted !== 1 ? 's' : ''})
            </span>
          </span>
        </div>

        {/* Observacao urgente: inline, ao lado da referencia. O piso de largura
            existe porque com codigo longo o grupo da esquerda comia o espaco
            todo e o campo ficava com poucos pixels — invisivel na pratica. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 lg:min-w-[18rem]">
          <input
            type="text"
            aria-label="Observação urgente do processo"
            value={urgentNote}
            onChange={(event) => setUrgentNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveUrgentNote();
              }
            }}
            placeholder="Observacao urgente"
            title={urgentNote || undefined}
            className="h-8 min-w-0 flex-1 truncate rounded-lg border border-red-300 bg-red-50 px-2.5 text-xs font-semibold text-red-800 placeholder:text-red-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-danger-700 dark:bg-danger-950/40 dark:text-danger-200 dark:placeholder:text-red-500"
          />
          <button
            type="button"
            onClick={saveUrgentNote}
            disabled={savingUrgentNote || !urgentNoteChanged}
            aria-label="Salvar observação urgente"
            title="Salvar observação urgente"
            className={cn(
              iconButton,
              'border-red-300 bg-red-600 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-danger-700',
            )}
          >
            <Save className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Acoes: so icone, com o mesmo nome acessivel de antes */}
        <div className="flex shrink-0 items-center gap-1.5">
          {process.driveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.driveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Abrir no Drive"
              title="Abrir no Drive"
              className={cn(
                iconButton,
                'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50',
              )}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {process.sistemaDriveFolderId && (
            <a
              href={`https://drive.google.com/drive/folders/${process.sistemaDriveFolderId}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Sistema Automatico"
              title="Sistema Automatico"
              className={cn(
                iconButton,
                'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-400 dark:hover:bg-primary-900/50',
              )}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <button
            onClick={onEdit}
            disabled={!!process.lockedAt}
            aria-label="Editar"
            title={process.lockedAt ? 'Processo travado — destrave para editar' : 'Editar'}
            className={cn(
              iconButton,
              process.lockedAt
                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            <Edit className="h-4 w-4" />
          </button>
          {process.lockedAt && canUnlock && (
            <button
              onClick={() => setShowUnlockConfirm(true)}
              aria-label="Destravar"
              title="Destravar"
              className={cn(
                iconButton,
                'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50',
              )}
            >
              <Unlock className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showUnlockConfirm}
        variant="danger"
        title="Destravar processo"
        message={`Destravar o processo ${process.processCode}? Aprovação do Vimbar permanece registrada no histórico, mas o sistema voltará a aceitar edições automáticas.`}
        confirmLabel="Destravar"
        onConfirm={handleUnlock}
        onCancel={() => setShowUnlockConfirm(false)}
      />
    </>
  );
}
