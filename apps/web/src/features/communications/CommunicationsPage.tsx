import { useRef, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Mail,
  Send,
  Save,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  User,
  AtSign,
  PenTool,
  FileDown,
  Paperclip,
  Search,
  X,
  Eye,
  HardDrive,
  Loader2,
  Upload,
} from 'lucide-react';
import { useApiQuery, useApiMutation } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';
import { cn, formatDate } from '@/shared/lib/utils';
import { downloadCsv } from '@/shared/lib/csv';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { DateRangeFilter } from '@/shared/components/DateRangeFilter';
import { SubmitButton } from '@/shared/components/SubmitButton';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { ModalPortal } from '@/shared/components/ModalPortal';
import { DocumentViewerModal } from '@/shared/components/DocumentViewerModal';
import { getErrorMessage } from '@/shared/utils/errors';

interface EmailSignatureOption {
  id: number;
  name: string;
  signatureHtml: string;
  isDefault: boolean;
}

interface CommunicationTemplateOption {
  id: number;
  name: string;
  recipient: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
  isActive: boolean;
}

interface Process {
  id: number;
  processCode: string;
  brand: string;
}

interface ProcessDocument {
  id: number;
  fileName: string;
  documentType: string;
  driveFileId?: string | null;
}

interface DriveFileOption {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  webViewLink: string | null;
}

interface Communication {
  id: number;
  processId: number;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename?: string; documentId?: number; espelhoId?: number }> | null;
  status: 'draft' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
}

type PaginatedCommunications = {
  data: Communication[];
  pagination: { page: number; limit: number; total: number; pages: number };
};

interface EmailDraft {
  subject: string;
  body: string;
}

interface ComposerForm {
  processId: string;
  recipient: string;
  recipientEmail: string;
  subject: string;
  body: string;
}

const emptyComposer: ComposerForm = {
  processId: '',
  recipient: '',
  recipientEmail: '',
  subject: '',
  body: '',
};

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  draft: {
    label: 'Rascunho',
    dot: 'bg-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900',
    text: 'text-slate-600 dark:text-slate-400',
  },
  sent: { label: 'Enviado', dot: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed: { label: 'Falhou', dot: 'bg-danger-500', bg: 'bg-danger-50', text: 'text-danger-700' },
};

export function CommunicationsPage() {
  const queryClient = useQueryClient();
  const [composer, setComposer] = useState<ComposerForm>(emptyComposer);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [sending, setSending] = useState(false);
  const [aiRecipientType, setAiRecipientType] = useState<'fenicia' | 'isa'>('fenicia');
  const [selectedSignatureId, setSelectedSignatureId] = useState<number | null>(null);
  const [processSearch, setProcessSearch] = useState('');
  const [debouncedProcessSearch, setDebouncedProcessSearch] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<number[]>([]);
  const [editingCommunicationId, setEditingCommunicationId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportingCsv, setExportingCsv] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFileOption[]>([]);
  const [loadingDriveFiles, setLoadingDriveFiles] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [importingDriveFileId, setImportingDriveFileId] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<ProcessDocument | null>(null);

  // Fetch signatures
  const { data: signatures } = useApiQuery<EmailSignatureOption[]>(
    ['email-signatures'],
    '/api/settings/email-signatures',
  );
  const { data: communicationTemplates } = useApiQuery<CommunicationTemplateOption[]>(
    ['communication-templates'],
    '/api/settings/communication-templates',
  );

  // Auto-select default signature
  useEffect(() => {
    if (signatures?.length && !selectedSignatureId) {
      const def = signatures.find((s) => s.isDefault);
      setSelectedSignatureId(def?.id ?? signatures[0]?.id ?? null);
    }
  }, [signatures, selectedSignatureId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedProcessSearch(processSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [processSearch]);

  const isProcessSearchReady = debouncedProcessSearch.length >= 2;
  const processSearchParams = new URLSearchParams({ page: '1', limit: '20' });
  if (isProcessSearchReady) processSearchParams.set('search', debouncedProcessSearch);
  const {
    data: processResponse,
    isFetching: loadingProcessOptions,
    error: processSearchError,
    refetch: refetchProcessOptions,
  } = useApiQuery<{ data: Process[]; pagination: unknown }>(
    ['communication-process-options', debouncedProcessSearch],
    `/api/processes?${processSearchParams.toString()}`,
    { enabled: isProcessSearchReady, staleTime: 30_000 },
  );
  const processOptions = isProcessSearchReady ? (processResponse?.data ?? []) : [];

  const { data: processDocuments } = useApiQuery<ProcessDocument[]>(
    ['documents', 'process', composer.processId],
    `/api/documents/process/${composer.processId}`,
    { enabled: Boolean(composer.processId) },
  );

  const commParams = new URLSearchParams();
  commParams.set('limit', '100');
  if (startDate) commParams.set('startDate', startDate);
  if (endDate) commParams.set('endDate', endDate);
  const commQs = commParams.toString();

  const {
    data: commsResponse,
    isLoading: loadingComms,
    error: commsError,
    refetch: refetchComms,
  } = useApiQuery<{ data: Communication[]; pagination: unknown }>(
    ['communications', startDate, endDate],
    `/api/communications${commQs ? `?${commQs}` : ''}`,
  );
  const communications = commsResponse?.data;

  const saveDraftMutation = useApiMutation<
    Communication,
    Omit<Communication, 'id' | 'status' | 'createdAt' | 'sentAt'>
  >('/api/communications', 'post', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      setComposer(emptyComposer);
      setProcessSearch('');
      setSelectedAttachmentIds([]);
      setEditingCommunicationId(null);
    },
  });

  const updateProcessSelection = (value: string) => {
    setProcessSearch(value);
    const selected = processOptions.find(
      (process) =>
        `${process.processCode} - ${process.brand}`.toLowerCase() === value.toLowerCase() ||
        process.processCode.toLowerCase() === value.toLowerCase(),
    );
    setComposer((prev) => ({ ...prev, processId: selected ? String(selected.id) : '' }));
    setSelectedAttachmentIds([]);
  };

  const communicationPayload = () => ({
    processId: Number(composer.processId),
    recipient: composer.recipient,
    recipientEmail: composer.recipientEmail.trim(),
    subject: composer.subject,
    body: composer.body,
    attachments: selectedAttachmentIds.map((documentId) => ({ documentId })),
  });

  const resetComposer = () => {
    setComposer(emptyComposer);
    setProcessSearch('');
    setSelectedAttachmentIds([]);
    setEditingCommunicationId(null);
  };

  const startEditingDraft = (comm: Communication) => {
    const option = processOptions.find((process) => process.id === comm.processId);
    setEditingCommunicationId(comm.id);
    setComposer({
      processId: String(comm.processId),
      recipient: comm.recipient,
      recipientEmail: comm.recipientEmail,
      subject: comm.subject,
      body: comm.body,
    });
    setProcessSearch(option ? `${option.processCode} - ${option.brand}` : String(comm.processId));
    setSelectedAttachmentIds(
      (comm.attachments ?? [])
        .map((attachment) => attachment.documentId)
        .filter((documentId): documentId is number => typeof documentId === 'number'),
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveExistingDraft = async () => {
    if (!editingCommunicationId) return;
    await api.patch<Communication>(`/api/communications/${editingCommunicationId}/draft`, {
      recipient: composer.recipient,
      recipientEmail: composer.recipientEmail,
      subject: composer.subject,
      body: composer.body,
      attachments: selectedAttachmentIds.map((documentId) => ({ documentId })),
    });
    toast.success('Rascunho atualizado');
    queryClient.invalidateQueries({ queryKey: ['communications'] });
    resetComposer();
  };

  const handleSaveDraft = async () => {
    if (editingCommunicationId) {
      try {
        await saveExistingDraft();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err));
      }
      return;
    }
    saveDraftMutation.mutate(communicationPayload());
  };

  // Enviar e-mail é irreversível — confirma antes (paridade com a Validação,
  // que já confirmava; auditoria 2026-07-17). Também valida o formato do
  // destinatário, que o isFormValid só checava como não-vazio.
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  const requestSend = () => {
    // Aceita lista separada por ; ou , (o campo sempre permitiu múltiplos
    // destinatários) — valida cada endereço individualmente.
    const addresses = composer.recipientEmail
      .split(/[;,]/)
      .map((a) => a.trim())
      .filter(Boolean);
    const invalid = addresses.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (addresses.length === 0 || invalid.length > 0) {
      toast.error(`E-mail do destinatário inválido: "${invalid[0] ?? composer.recipientEmail}"`);
      return;
    }
    setShowSendConfirm(true);
  };

  const handleSend = async () => {
    setShowSendConfirm(false);
    setSending(true);
    try {
      const draftId = editingCommunicationId
        ? editingCommunicationId
        : (await api.post<Communication>('/api/communications', communicationPayload())).id;
      if (editingCommunicationId) {
        await api.patch<Communication>(`/api/communications/${editingCommunicationId}/draft`, {
          recipient: composer.recipient,
          recipientEmail: composer.recipientEmail,
          subject: composer.subject,
          body: composer.body,
          attachments: selectedAttachmentIds.map((documentId) => ({ documentId })),
        });
      }
      await api.post(`/api/communications/${draftId}/send`, {
        signatureId: selectedSignatureId,
      });
      toast.success('E-mail enviado com sucesso');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      resetComposer();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const handleGenerateAi = async () => {
    if (!composer.processId) return;
    setGeneratingAi(true);
    try {
      const draft = await api.post<EmailDraft>('/api/ai/email-draft', {
        processId: Number(composer.processId),
        recipientType: aiRecipientType,
      });
      setComposer((prev) => ({
        ...prev,
        subject: draft.subject,
        body: draft.body,
      }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      const rows: Communication[] = [];
      let page = 1;
      let pages = 1;

      do {
        const exportParams = new URLSearchParams(commParams);
        exportParams.set('page', String(page));
        exportParams.set('limit', '100');
        const response = await api.get<PaginatedCommunications>(
          `/api/communications?${exportParams.toString()}`,
        );
        rows.push(...response.data);
        pages = response.pagination.pages || 1;
        page += 1;
      } while (page <= pages);

      if (!rows.length) {
        toast.error('Nenhum atendimento para exportar com os filtros atuais.');
        return;
      }

      downloadCsv('atendimentos-importacao.csv', [
        [
          'ID',
          'Processo',
          'Destinatário',
          'E-mail',
          'Assunto',
          'Status',
          'Criado em',
          'Enviado em',
          'Mensagem',
        ],
        ...rows.map((comm) => [
          comm.id,
          comm.processId,
          comm.recipient,
          comm.recipientEmail,
          comm.subject,
          statusConfig[comm.status]?.label ?? comm.status,
          comm.createdAt,
          comm.sentAt || '',
          comm.body,
        ]),
      ]);
      toast.success(`Relatório de atendimentos exportado em CSV (${rows.length} registros).`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setExportingCsv(false);
    }
  };

  /**
   * Anexo vindo do computador.
   *
   * Reaproveita `POST /api/documents/upload` — o arquivo entra como documento do
   * processo (mesmo storage, auditoria, timeline e sincronia com o Drive) e so
   * depois e marcado como anexo do e-mail. Nao existe storage paralelo de anexo.
   */
  const handleUploadFromComputer = async (file: File) => {
    if (!composer.processId) {
      toast.error('Selecione o processo antes de anexar um arquivo.');
      return;
    }
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('processId', composer.processId);
      formData.append('documentType', 'other');

      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${baseUrl}/api/documents/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || `Falha no upload (${response.status})`);
      }

      const uploaded = payload?.data ?? payload;
      if (uploaded?.id) setSelectedAttachmentIds((prev) => [...prev, uploaded.id]);
      queryClient.invalidateQueries({ queryKey: ['documents', 'process', composer.processId] });
      toast.success(`"${file.name}" anexado e salvo no processo.`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openDrivePicker = async () => {
    if (!composer.processId) {
      toast.error('Selecione o processo antes de anexar um arquivo.');
      return;
    }
    setShowDrivePicker(true);
    setLoadingDriveFiles(true);
    setDriveError(null);
    try {
      const files = await api.get<DriveFileOption[]>(
        `/api/communications/drive/files?processId=${composer.processId}`,
      );
      setDriveFiles(files);
    } catch (err: unknown) {
      setDriveError(getErrorMessage(err));
    } finally {
      setLoadingDriveFiles(false);
    }
  };

  /** Importa o arquivo do Drive como documento do processo e ja o marca como anexo. */
  const importDriveFile = async (driveFile: DriveFileOption) => {
    setImportingDriveFileId(driveFile.id);
    try {
      const document = await api.post<ProcessDocument>('/api/communications/drive/import', {
        processId: Number(composer.processId),
        driveFileId: driveFile.id,
        documentType: 'other',
      });
      if (document?.id) setSelectedAttachmentIds((prev) => [...prev, document.id]);
      queryClient.invalidateQueries({ queryKey: ['documents', 'process', composer.processId] });
      toast.success(`"${driveFile.name}" anexado e salvo no processo.`);
      setShowDrivePicker(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setImportingDriveFileId(null);
    }
  };

  const applySavedTemplate = (template: CommunicationTemplateOption) => {
    setComposer((prev) => ({
      ...prev,
      recipient: template.recipient ?? prev.recipient,
      recipientEmail: template.recipientEmail ?? prev.recipientEmail,
      subject: template.subject,
      body: template.body,
    }));
  };

  const applyTemplate = (template: 'fenicia' | 'isa') => {
    const templates: Record<string, { subject: string; body: string }> = {
      fenicia: {
        subject: 'Documentos para análise - Processo de importação',
        body: `Prezados,\n\nSegue em anexo os documentos referentes ao processo de importação para análise e providências.\n\nFicamos no aguardo do retorno.\n\nAtenciosamente,`,
      },
      isa: {
        subject: 'Solicitação de documentos - Importação',
        body: `Prezada Isa,\n\nGostaríamos de solicitar os documentos pendentes referentes ao processo de importação.\n\nPor gentileza, enviar com a maior brevidade possível.\n\nAtenciosamente,`,
      },
    };
    const t = templates[template];
    setComposer((prev) => ({ ...prev, subject: t.subject, body: t.body }));
  };

  const isFormValid =
    composer.processId &&
    composer.recipient &&
    composer.recipientEmail &&
    composer.subject &&
    composer.body;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Atendimentos e E-mails
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Crie, envie e acompanhe interações vinculadas aos processos de importação.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={exportingCsv || !communications?.length}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <FileDown className="h-4 w-4" />
          {exportingCsv ? 'Exportando...' : 'Exportar CSV'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-5">
        {/* Composer - takes 3 cols */}
        <div className="xl:col-span-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
            {/* Gradient header */}
            <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-4 sm:px-6 py-4">
              <h3 className="flex items-center gap-2.5 text-lg font-semibold text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20">
                  <Mail className="h-4.5 w-4.5 text-white" />
                </div>
                {editingCommunicationId
                  ? 'Editar rascunho por e-mail'
                  : 'Novo atendimento por e-mail'}
              </h3>
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              {/* Process select */}
              <div>
                <label
                  htmlFor="comm-process"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Processo
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    id="comm-process"
                    list="comm-process-list"
                    value={processSearch}
                    onChange={(e) => updateProcessSelection(e.target.value)}
                    aria-describedby="comm-process-hint"
                    placeholder="Digite ao menos 2 caracteres"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm text-slate-700 dark:text-slate-300 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  />
                  {processSearch && (
                    <button
                      type="button"
                      onClick={() => updateProcessSelection('')}
                      className="absolute right-2 top-2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      aria-label="Limpar processo"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <datalist id="comm-process-list">
                    {processOptions.map((process) => (
                      <option
                        key={process.id}
                        value={`${process.processCode} - ${process.brand}`}
                      />
                    ))}
                  </datalist>
                </div>
                <div id="comm-process-hint" className="mt-1.5 text-xs text-slate-400">
                  {processSearch.trim().length > 0 && !isProcessSearchReady ? (
                    'Digite pelo menos 2 caracteres para buscar.'
                  ) : loadingProcessOptions ? (
                    'Buscando processos...'
                  ) : processSearchError ? (
                    <button
                      type="button"
                      onClick={() => refetchProcessOptions()}
                      className="font-medium text-danger-600 hover:underline"
                    >
                      Não foi possível buscar processos. Tentar novamente.
                    </button>
                  ) : isProcessSearchReady && processResponse && processOptions.length === 0 ? (
                    'Nenhum processo encontrado para esta busca.'
                  ) : (
                    'Busque pelo código do processo e selecione uma opção.'
                  )}
                </div>
              </div>

              {/* Recipient fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="comm-recipient"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    Destinatário
                  </label>
                  <input
                    id="comm-recipient"
                    type="text"
                    value={composer.recipient}
                    onChange={(e) => setComposer({ ...composer, recipient: e.target.value })}
                    placeholder="Nome do destinatário"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  />
                </div>
                <div>
                  <label
                    htmlFor="comm-recipient-email"
                    className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
                  >
                    <AtSign className="h-3.5 w-3.5 text-slate-400" />
                    E-mail
                  </label>
                  <input
                    id="comm-recipient-email"
                    type="text"
                    value={composer.recipientEmail}
                    onChange={(e) => setComposer({ ...composer, recipientEmail: e.target.value })}
                    placeholder="email@exemplo.com, outro@exemplo.com"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Subject */}
              <div>
                <label
                  htmlFor="comm-subject"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Assunto
                </label>
                <input
                  id="comm-subject"
                  type="text"
                  value={composer.subject}
                  onChange={(e) => setComposer({ ...composer, subject: e.target.value })}
                  placeholder="Assunto do e-mail"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                />
              </div>

              {/* Body */}
              <div>
                <label
                  htmlFor="comm-body"
                  className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Mensagem
                </label>
                <textarea
                  id="comm-body"
                  value={composer.body}
                  onChange={(e) => setComposer({ ...composer, body: e.target.value })}
                  rows={5}
                  placeholder="Escreva o conteúdo do e-mail..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none transition-all"
                  style={{ minHeight: '120px' }}
                />
              </div>

              {/* Modelos e IA */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                  Modelos e IA
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* AI with recipient selector */}
                  <div className="inline-flex items-center rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50 to-violet-50 dark:from-violet-950/40 dark:to-violet-950/40 overflow-hidden">
                    <select
                      aria-label="Destinatário do modelo gerado por IA"
                      value={aiRecipientType}
                      onChange={(e) => setAiRecipientType(e.target.value as 'fenicia' | 'isa')}
                      className="bg-transparent border-none text-xs font-medium text-violet-600 pl-3 pr-1 py-2 focus:ring-0"
                    >
                      <option value="fenicia">Fenícia</option>
                      <option value="isa">Isa</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleGenerateAi}
                      disabled={!composer.processId || generatingAi}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100/50 disabled:opacity-50 transition-all"
                    >
                      <Sparkles className="h-4 w-4" />
                      {generatingAi ? 'Gerando...' : 'Gerar com IA'}
                    </button>
                  </div>
                  {communicationTemplates && communicationTemplates.length > 0 ? (
                    communicationTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applySavedTemplate(template)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                      >
                        <FileText className="h-4 w-4 text-slate-400" />
                        {template.name}
                      </button>
                    ))
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => applyTemplate('fenicia')}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                      >
                        <FileText className="h-4 w-4 text-slate-400" />
                        Modelo Fenícia
                      </button>
                      <button
                        type="button"
                        onClick={() => applyTemplate('isa')}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 hover:border-slate-300 transition-all"
                      >
                        <FileText className="h-4 w-4 text-slate-400" />
                        Modelo Isa
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Signature selector */}
              {signatures && signatures.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
                    Assinatura
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {signatures.map((sig) => (
                      <button
                        key={sig.id}
                        type="button"
                        onClick={() => setSelectedSignatureId(sig.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all',
                          selectedSignatureId === sig.id
                            ? 'border-primary-300 bg-primary-50 text-primary-700'
                            : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800',
                        )}
                      >
                        <PenTool className="h-3 w-3" />
                        {sig.name}
                        {sig.isDefault && (
                          <span className="text-[10px] text-primary-400">(padrão)</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {selectedSignatureId && (
                    <div className="mt-2 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                        Preview
                      </p>
                      <div
                        className="text-xs text-slate-600 dark:text-slate-400"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            signatures.find((s) => s.id === selectedSignatureId)?.signatureHtml ||
                              '',
                          ),
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {composer.processId && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
                      <Paperclip className="h-3.5 w-3.5" />
                      Anexos do processo
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        aria-label="Anexar arquivo do computador"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) handleUploadFromComputer(file);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                      >
                        {uploadingFile ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        Do computador
                      </button>
                      <button
                        type="button"
                        onClick={openDrivePicker}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
                      >
                        <HardDrive className="h-3.5 w-3.5" />
                        Do Google Drive
                      </button>
                    </div>
                  </div>
                  {!processDocuments?.length ? (
                    <p className="rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-400">
                      Nenhum documento disponível para anexar. Use os botões acima para anexar do
                      computador ou do Google Drive — o arquivo fica salvo no processo.
                    </p>
                  ) : (
                    <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 p-2">
                      {processDocuments.map((doc) => {
                        const checked = selectedAttachmentIds.includes(doc.id);
                        return (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedAttachmentIds((prev) =>
                                    event.target.checked
                                      ? [...prev, doc.id]
                                      : prev.filter((id) => id !== doc.id),
                                  );
                                }}
                                className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-primary-600"
                              />
                              <span className="shrink-0 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500">
                                {doc.documentType}
                              </span>
                              <span className="truncate">{doc.fileName}</span>
                            </label>
                            <button
                              type="button"
                              onClick={() => setPreviewDocument(doc)}
                              title="Visualizar no sistema"
                              aria-label={`Visualizar ${doc.fileName}`}
                              className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-slate-700"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 border-t border-slate-100 dark:border-slate-700 pt-5">
                {editingCommunicationId && (
                  <button
                    type="button"
                    onClick={resetComposer}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-900 transition-all"
                  >
                    Cancelar edição
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={!isFormValid || saveDraftMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 disabled:opacity-50 transition-all"
                >
                  <Save className="h-4 w-4" />
                  {editingCommunicationId ? 'Atualizar rascunho' : 'Salvar rascunho'}
                </button>
                <SubmitButton
                  type="button"
                  onClick={requestSend}
                  loading={sending}
                  disabled={!isFormValid || sending}
                >
                  <Send className="h-4 w-4" />
                  {editingCommunicationId ? 'Atualizar e enviar' : 'Enviar e-mail'}
                </SubmitButton>
                <ConfirmDialog
                  isOpen={showSendConfirm}
                  title="Enviar e-mail?"
                  message={`O e-mail "${composer.subject}" será enviado para ${composer.recipientEmail}. Esta ação não pode ser desfeita.`}
                  confirmLabel="Enviar"
                  cancelLabel="Cancelar"
                  variant="primary"
                  onConfirm={handleSend}
                  onCancel={() => setShowSendConfirm(false)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* History - takes 2 cols */}
        <div className="xl:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800 dark:border-slate-700/80 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="border-b border-slate-100 dark:border-slate-700 px-4 sm:px-6 py-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2.5 text-base font-semibold text-slate-900 dark:text-slate-100">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                    <Clock className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  </div>
                  Histórico de atendimentos
                </h3>
                {communications?.length ? (
                  <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                    {communications.length}
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                <DateRangeFilter
                  startDate={startDate}
                  endDate={endDate}
                  onStartDateChange={setStartDate}
                  onEndDateChange={setEndDate}
                  label="Período"
                  showLabel={false}
                />
              </div>
            </div>

            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {commsError ? (
                <ErrorState
                  message="Erro ao carregar atendimentos."
                  onRetry={() => refetchComms()}
                />
              ) : loadingComms ? (
                <LoadingSpinner className="py-12" />
              ) : !communications?.length ? (
                <EmptyState
                  icon={Mail}
                  title="Nenhum atendimento"
                  description="Os e-mails enviados e rascunhos aparecem aqui."
                />
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                  {communications.map((comm) => {
                    const isExpanded = expandedId === comm.id;
                    const config = statusConfig[comm.status] || statusConfig.draft;
                    return (
                      <div key={comm.id}>
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={`communication-details-${comm.id}`}
                          onClick={() => setExpandedId(isExpanded ? null : comm.id)}
                          className="w-full px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {comm.recipient}
                                </p>
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
                                  {config.label}
                                </span>
                              </div>
                              <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                                {comm.subject}
                              </p>
                              <p className="mt-1.5 text-xs text-slate-400">
                                {formatDate(comm.sentAt || comm.createdAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center pt-0.5">
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4 text-slate-400" />
                              ) : (
                                <ChevronDown className="h-4 w-4 text-slate-400" />
                              )}
                            </div>
                          </div>
                        </button>
                        {isExpanded && (
                          <div
                            id={`communication-details-${comm.id}`}
                            className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/60 px-3 sm:px-5 py-4"
                          >
                            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                              <AtSign className="h-3 w-3" />
                              {comm.recipient} &lt;{comm.recipientEmail}&gt;
                            </div>
                            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                              {comm.subject}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                              {comm.body}
                            </p>
                            {comm.attachments && comm.attachments.length > 0 && (
                              <div className="mt-3 space-y-1">
                                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                  <Paperclip className="h-3 w-3" />
                                  Anexos
                                </p>
                                {comm.attachments.map((attachment, index) => (
                                  <button
                                    key={`${comm.id}-${attachment.documentId ?? attachment.espelhoId ?? index}`}
                                    type="button"
                                    disabled={!attachment.documentId}
                                    onClick={() =>
                                      attachment.documentId &&
                                      setPreviewDocument({
                                        id: attachment.documentId,
                                        fileName:
                                          attachment.filename ??
                                          `Documento ${attachment.documentId}`,
                                        documentType: 'other',
                                      })
                                    }
                                    className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-600 transition-colors hover:border-primary-200 hover:bg-primary-50/50 disabled:cursor-default disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:hover:bg-slate-800"
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    <span className="truncate">
                                      {attachment.filename ??
                                        `Documento ${attachment.documentId ?? attachment.espelhoId}`}
                                    </span>
                                    {attachment.documentId && (
                                      <Eye className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                            {(comm.status === 'draft' || comm.status === 'failed') && (
                              <div className="mt-4 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => startEditingDraft(comm)}
                                  className="inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-primary-100"
                                >
                                  <PenTool className="h-3.5 w-3.5" />
                                  {comm.status === 'failed'
                                    ? 'Corrigir e tentar novamente'
                                    : 'Editar rascunho'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showDrivePicker && (
        <ModalPortal onEscape={() => setShowDrivePicker(false)}>
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-sidebar-950/50 backdrop-blur-sm"
              onClick={() => setShowDrivePicker(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="drive-picker-title"
              className="relative z-10 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-800"
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700 sm:px-6">
                <h2
                  id="drive-picker-title"
                  className="flex items-center gap-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                    <HardDrive className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                  </div>
                  Anexar do Google Drive
                </h2>
                <button
                  type="button"
                  onClick={() => setShowDrivePicker(false)}
                  aria-label="Fechar seletor do Drive"
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-[12rem] flex-1 overflow-y-auto p-4 sm:p-6">
                {loadingDriveFiles ? (
                  <LoadingSpinner className="py-10" />
                ) : driveError ? (
                  <ErrorState message={driveError} onRetry={openDrivePicker} />
                ) : driveFiles.length === 0 ? (
                  <EmptyState
                    icon={HardDrive}
                    title="Nenhum arquivo na pasta do processo"
                    description="A pasta deste processo no Google Drive não tem arquivos anexáveis."
                  />
                ) : (
                  <div className="space-y-1">
                    {driveFiles.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-700"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-700 dark:text-slate-200">
                            {file.name}
                          </p>
                          <p className="text-xs text-slate-400">
                            {file.size != null
                              ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                              : 'tamanho desconhecido'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => importDriveFile(file)}
                          disabled={importingDriveFileId !== null}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                        >
                          {importingDriveFileId === file.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Paperclip className="h-3.5 w-3.5" />
                          )}
                          Anexar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400 dark:border-slate-700 sm:px-6">
                O arquivo escolhido é salvo como documento deste processo antes de virar anexo.
              </p>
            </div>
          </div>
        </ModalPortal>
      )}

      <DocumentViewerModal
        documentId={previewDocument?.id ?? null}
        fileName={previewDocument?.fileName}
        driveFileId={previewDocument?.driveFileId}
        onClose={() => setPreviewDocument(null)}
      />
    </div>
  );
}
