import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider } from '@/test/mocks/auth';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { DocumentList } from './DocumentList';
import { useApiQuery } from '@/shared/hooks/useApi';

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
