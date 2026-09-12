import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider } from '@/test/mocks/auth';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('@/shared/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { toast } from 'sonner';
import { DocumentList } from './DocumentList';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';

function renderDocumentList(documents: unknown[], role: 'admin' | 'analyst' = 'analyst') {
  vi.mocked(useApiQuery).mockReturnValue({
    data: documents,
    isLoading: false,
    refetch: mockRefetch,
    error: null,
    isError: false,
  } as unknown as ReturnType<typeof useApiQuery>);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MockAuthProvider
        value={{ user: { id: '1', name: 'Operadora', email: 'op@grupounico.com', role } }}
      >
        <DocumentList processId="1" />
      </MockAuthProvider>
    </QueryClientProvider>,
  );
}

describe('DocumentList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([0.89, null])('BL com confiança %s não é utilizável', (confidence) => {
    renderDocumentList([
      {
        id: 20,
        fileName: 'bl.pdf',
        documentType: 'ohbl',
        uploadedAt: '2026-09-12T12:00:00.000Z',
        aiProcessingStatus: 'completed',
        aiConfidence: confidence,
        aiParsedData: { containerNumber: { value: 'MSCU1234567' } },
      },
    ]);
    expect(screen.getByText(/IA: 0\/1 extraídos/i)).toBeInTheDocument();
    expect(screen.getAllByText(/não utilizável/i).length).toBeGreaterThan(0);
  });

  it('marks completed low-confidence documents as not usable', () => {
    renderDocumentList([
      {
        id: 10,
        fileName: 'invoice.pdf',
        documentType: 'invoice',
        uploadedAt: '2026-06-10T12:00:00.000Z',
        aiProcessingStatus: 'completed',
        aiConfidence: 0.39,
        aiParsedData: {
          invoiceNumber: { value: 'INV-1', confidence: 0.9 },
        },
      },
    ]);

    expect(screen.getByText(/IA: 0\/1 extraídos/i)).toBeInTheDocument();
    expect(screen.getAllByText(/não utilizável/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/39% não utilizável/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Ver dados extraidos de invoice.pdf/i));

    expect(screen.getByText(/Baixa confiança/i)).toBeInTheDocument();
    expect(screen.getByText(/Use estes dados apenas para revisão manual/i)).toBeInTheDocument();
  });

  // D8 — reuniao 11/09: o rascunho da DUIMP foi para o processo errado e a
  // analista nao tinha o botao ("voces estao sem acesso, eu vou liberar").
  it('deixa a analista excluir, mas so com motivo, e envia pelo api-client', async () => {
    vi.mocked(api.delete).mockResolvedValue(undefined);
    renderDocumentList([
      {
        id: 12,
        fileName: 'RASCUNHO DUIMP.pdf',
        documentType: 'draft_duimp',
        uploadedAt: '2026-09-11T12:00:00.000Z',
        aiProcessingStatus: 'completed',
        aiConfidence: 0.82,
        aiParsedData: { duimpNumber: { value: '26BR0001', confidence: 0.9 } },
      },
    ]);

    fireEvent.click(screen.getByLabelText(/Excluir documento RASCUNHO DUIMP.pdf/i));

    const confirmar = screen.getByRole('button', { name: 'Excluir' });
    expect(confirmar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Motivo da exclusão/i), {
      target: { value: 'Anexado no processo errado' },
    });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.delete).mock.calls[0][0]).toBe('/api/documents/12');
    expect(vi.mocked(api.delete).mock.calls[0][1]).toEqual({
      reason: 'Anexado no processo errado',
    });
  });

  it('mostra a mensagem real do backend quando a exclusao e recusada', async () => {
    // O `fetch` cru transformava o 423 em "Falha ao excluir documento".
    vi.mocked(api.delete).mockRejectedValue(
      new Error('Processo travado em 2026-09-10 (motivo: manual). Destrave antes.'),
    );
    renderDocumentList([
      {
        id: 13,
        fileName: 'bl.pdf',
        documentType: 'ohbl',
        uploadedAt: '2026-09-11T12:00:00.000Z',
        aiProcessingStatus: 'completed',
        aiConfidence: 0.9,
        aiParsedData: { blNumber: { value: 'BL-1', confidence: 0.9 } },
      },
    ]);

    fireEvent.click(screen.getByLabelText(/Excluir documento bl.pdf/i));
    fireEvent.change(screen.getByLabelText(/Motivo da exclusão/i), {
      target: { value: 'Documento duplicado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Processo travado em 2026-09-10 (motivo: manual). Destrave antes.',
      ),
    );
  });

  it('allows an analyst to recover a document by reprocessing or correcting its classification', () => {
    renderDocumentList([
      {
        id: 11,
        fileName: 'anexo.pdf',
        documentType: 'other',
        uploadedAt: '2026-06-10T12:00:00.000Z',
        aiProcessingStatus: 'failed',
        aiConfidence: 0,
        aiParsedData: { extractionFailed: true, reason: 'Tipo sem extractor dedicado' },
      },
    ]);

    expect(screen.getByLabelText(/Reprocessar IA de anexo.pdf/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Corrigir classificação de anexo.pdf/i));
    expect(screen.getByLabelText(/Tipo correto/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar e reprocessar/i })).toBeInTheDocument();
  });
});
