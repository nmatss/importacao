import { useState } from 'react';
import { toast } from 'sonner';
import {
  Download,
  Upload,
  Send,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/shared/hooks/useApi';
import { cn, formatCurrency, formatWeight } from '@/shared/lib/utils';
import { LoadingSpinner } from '@/shared/components/LoadingSpinner';
import { getErrorMessage } from '@/shared/utils/errors';

interface EspelhoItem {
  id: number;
  itemCode: string;
  description: string;
  color: string;
  size: string;
  ncm: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  boxes: number;
  netWeight: number;
  grossWeight: number;
  isFoc: boolean;
  requiresLi: boolean;
  requiresCert: boolean;
}

interface Espelho {
  id: number;
  status: string;
  items: EspelhoItem[];
  totalFobValue: number;
  totalQuantity: number;
  totalNetWeight: number;
  totalGrossWeight: number;
  totalBoxes: number;
  driveFileId?: string | null;
  driveSentAt?: string | null;
  sentToFenicia?: boolean;
  sentToFeniciaAt?: string | null;
}

interface EspelhoPreviewProps {
  processId: string;
}

export function EspelhoPreview({ processId }: EspelhoPreviewProps) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [editingCell, setEditingCell] = useState<{
    itemId: number;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState('');

  const { data: espelho, isLoading } = useApiQuery<Espelho>(
    ['espelho', processId],
    `/api/espelhos/${processId}`,
  );

  const apiCall = async (path: string, method = 'POST', body?: unknown) => {
    const token = localStorage.getItem('importacao_token');
    const baseUrl = import.meta.env.VITE_API_URL || '';
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await apiCall(`/api/espelhos/${processId}/generate`);
      if (!res.ok) throw new Error('Falha ao gerar espelho');
      queryClient.invalidateQueries({ queryKey: ['espelho', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const downloadXlsx = async () => {
    try {
      const token = localStorage.getItem('importacao_token');
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${baseUrl}/api/espelhos/${processId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao baixar espelho');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `espelho_${processId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const sendToDrive = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/send-drive`);
      if (!res.ok) throw new Error('Falha ao enviar para Drive');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };
  const sendToFenicia = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/send-fenicia`);
      if (!res.ok) throw new Error('Falha ao enviar para Fenicia');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };
  const generatePartialLi = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/generate-li`);
      if (!res.ok) throw new Error('Falha ao gerar parcial LI');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const startEdit = (itemId: number, field: string, currentValue: string | number) => {
    setEditingCell({ itemId, field });
    setEditValue(String(currentValue));
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    try {
      const res = await apiCall(`/api/espelhos/${processId}/items/${editingCell.itemId}`, 'PATCH', {
        [editingCell.field]: editValue,
      });
      if (!res.ok) throw new Error('Falha ao salvar edicao');
      setEditingCell(null);
      queryClient.invalidateQueries({ queryKey: ['espelho', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const addItem = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/items`, 'POST', {
        itemCode: '',
        description: 'Novo Item',
        color: '',
        size: '',
        ncm: '',
        unitPrice: 0,
        quantity: 0,
      });
      if (!res.ok) throw new Error('Falha ao adicionar item');
      queryClient.invalidateQueries({ queryKey: ['espelho', processId] });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err));
    }
  };

  const renderCell = (item: EspelhoItem, field: string, value: string | number) => {
    const isEditing = editingCell?.itemId === item.id && editingCell?.field === field;

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveEdit();
            if (e.key === 'Escape') setEditingCell(null);
          }}
          className="w-full rounded border border-primary-400 px-1 py-0.5 text-xs focus:outline-none"
        />
      );
    }

    return (
      <span
        onDoubleClick={() => startEdit(item.id, field, value)}
        className="cursor-pointer hover:bg-primary-50 dark:hover:bg-primary-950/30 rounded px-1 py-0.5 block"
        title="Clique duplo para editar"
      >
        {value}
      </span>
    );
  };

  if (isLoading) {
    return <LoadingSpinner className="py-8" />;
  }

  const rowBg = (item: EspelhoItem) => {
    if (item.isFoc) return 'bg-amber-50';
    if (item.requiresLi) return 'bg-violet-50';
    if (item.requiresCert) return 'bg-orange-50';
    return '';
  };

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {generating ? <LoadingSpinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
          Gerar Espelho
        </button>

        {espelho && (
          <>
            <button
              onClick={downloadXlsx}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors"
            >
              <Download className="h-4 w-4" />
              Baixar XLSX
            </button>
            <button
              onClick={sendToDrive}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors"
            >
              <Upload className="h-4 w-4" />
              Enviar para Drive
            </button>
            <button
              onClick={sendToFenicia}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-900 transition-colors"
            >
              <Send className="h-4 w-4" />
              Enviar para Fenícia
            </button>
            <button
              onClick={generatePartialLi}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 transition-colors"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Gerar Parcial (LI)
            </button>
          </>
        )}
      </div>

      {/* Legend */}
      {espelho && (
        <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-200" /> FOC
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-violet-200" /> LI
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-orange-200" /> Certificado
          </span>
        </div>
      )}

      {/* Sent status indicators (Gap 7) */}
      {espelho && (espelho.driveFileId || espelho.sentToFenicia) && (
        <div className="flex flex-wrap gap-3">
          {espelho.driveFileId && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle className="h-4 w-4" />
              Enviado ao Drive
              {espelho.driveSentAt && (
                <span className="text-xs text-emerald-600">
                  em{' '}
                  {new Date(espelho.driveSentAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          )}
          {espelho.sentToFenicia && (
            <div className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
              <CheckCircle className="h-4 w-4" />
              Enviado a Fenicia
              {espelho.sentToFeniciaAt && (
                <span className="text-xs text-orange-600">
                  em{' '}
                  {new Date(espelho.sentToFeniciaAt).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {espelho ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900">
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Código
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Descrição
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Cor
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tamanho
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  NCM
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Preço Unit.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Qtd.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Total
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Caixas
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Peso Líq.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Peso Bruto
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-800">
              {espelho.items.map((item) => (
                <tr key={item.id} className={cn('transition-colors', rowBg(item))}>
                  <td className="px-3 py-2">{renderCell(item, 'itemCode', item.itemCode)}</td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {renderCell(item, 'description', item.description)}
                  </td>
                  <td className="px-3 py-2">{renderCell(item, 'color', item.color)}</td>
                  <td className="px-3 py-2">{renderCell(item, 'size', item.size)}</td>
                  <td className="px-3 py-2">{renderCell(item, 'ncm', item.ncm)}</td>
                  <td className="px-3 py-2 text-right">
                    {renderCell(item, 'unitPrice', Number(item.unitPrice).toFixed(2))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {renderCell(item, 'quantity', item.quantity)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatCurrency(item.totalPrice)}
                  </td>
                  <td className="px-3 py-2 text-right">{renderCell(item, 'boxes', item.boxes)}</td>
                  <td className="px-3 py-2 text-right">{formatWeight(item.netWeight)}</td>
                  <td className="px-3 py-2 text-right">{formatWeight(item.grossWeight)}</td>
                </tr>
              ))}

              {/* Totals row */}
              <tr className="bg-slate-100 dark:bg-slate-700 font-semibold">
                <td colSpan={5} className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                  Totais
                </td>
                <td className="px-3 py-2 text-right" />
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">
                  {espelho.totalQuantity}
                </td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">
                  {formatCurrency(espelho.totalFobValue)}
                </td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">
                  {espelho.totalBoxes}
                </td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">
                  {formatWeight(espelho.totalNetWeight)}
                </td>
                <td className="px-3 py-2 text-right text-slate-900 dark:text-slate-100">
                  {formatWeight(espelho.totalGrossWeight)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 py-12 text-center">
          <FileSpreadsheet className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Nenhum espelho gerado ainda. Clique em "Gerar Espelho" para criar.
          </p>
        </div>
      )}

      {/* Add item */}
      {espelho && (
        <button
          onClick={addItem}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <Plus className="h-4 w-4" />
          Adicionar item
        </button>
      )}
    </div>
  );
}
