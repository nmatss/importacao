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
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar espelho');
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
    } catch (err: any) {
      toast.error(err.message || 'Erro ao baixar espelho');
    }
  };

  const sendToDrive = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/send-drive`);
      if (!res.ok) throw new Error('Falha ao enviar para Drive');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar para Drive');
    }
  };
  const sendToFenicia = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/send-fenicia`);
      if (!res.ok) throw new Error('Falha ao enviar para Fenicia');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar para Fenicia');
    }
  };
  const generatePartialLi = async () => {
    try {
      const res = await apiCall(`/api/espelhos/${processId}/generate-li`);
      if (!res.ok) throw new Error('Falha ao gerar parcial LI');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar parcial LI');
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
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar edicao');
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
    } catch (err: any) {
      toast.error(err.message || 'Erro ao adicionar item');
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
          className="w-full rounded border border-blue-400 px-1 py-0.5 text-xs focus:outline-none"
        />
      );
    }

    return (
      <span
        onDoubleClick={() => startEdit(item.id, field, value)}
        className="cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 block"
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
    if (item.isFoc) return 'bg-yellow-50';
    if (item.requiresLi) return 'bg-purple-50';
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
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {generating ? <LoadingSpinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
          Gerar Espelho
        </button>

        {espelho && (
          <>
            <button
              onClick={downloadXlsx}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Download className="h-4 w-4" />
              Baixar XLSX
            </button>
            <button
              onClick={sendToDrive}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Upload className="h-4 w-4" />
              Enviar para Drive
            </button>
            <button
              onClick={sendToFenicia}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Send className="h-4 w-4" />
              Enviar para Fenícia
            </button>
            <button
              onClick={generatePartialLi}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Gerar Parcial (LI)
            </button>
          </>
        )}
      </div>

      {/* Legend */}
      {espelho && (
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-yellow-200" /> FOC
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-purple-200" /> LI
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
            <div className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4" />
              Enviado ao Drive
              {espelho.driveSentAt && (
                <span className="text-xs text-green-600">
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
        <div className="rounded-lg border border-gray-200 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-gray-500">
                  Código
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-gray-500">
                  Descrição
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-gray-500">
                  Cor
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-gray-500">
                  Tamanho
                </th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-gray-500">
                  NCM
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Preço Unit.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Qtd.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Total
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Caixas
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Peso Líq.
                </th>
                <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-gray-500">
                  Peso Bruto
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
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
              <tr className="bg-gray-100 font-semibold">
                <td colSpan={5} className="px-3 py-2 text-right text-gray-700">
                  Totais
                </td>
                <td className="px-3 py-2 text-right" />
                <td className="px-3 py-2 text-right text-gray-900">{espelho.totalQuantity}</td>
                <td className="px-3 py-2 text-right text-gray-900">
                  {formatCurrency(espelho.totalFobValue)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900">{espelho.totalBoxes}</td>
                <td className="px-3 py-2 text-right text-gray-900">
                  {formatWeight(espelho.totalNetWeight)}
                </td>
                <td className="px-3 py-2 text-right text-gray-900">
                  {formatWeight(espelho.totalGrossWeight)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center">
          <FileSpreadsheet className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            Nenhum espelho gerado ainda. Clique em "Gerar Espelho" para criar.
          </p>
        </div>
      )}

      {/* Add item */}
      {espelho && (
        <button
          onClick={addItem}
          className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          <Plus className="h-4 w-4" />
          Adicionar item
        </button>
      )}
    </div>
  );
}
