import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftBLTab } from './DraftBLTab';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  refetchChecklist: vi.fn(),
}));

vi.mock('@/shared/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: mocks.patch,
  },
}));

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: (key: readonly unknown[]) => {
    if (key[0] === 'documents') {
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    }
    if (key[0] === 'draft-bl-checklist') {
      return {
        data: {
          draftReceivedOk: {
            checked: true,
            timestamp: '2026-08-28T15:00:00.000Z',
            checkedBy: 7,
            checkedByName: 'Operadora QA',
          },
        },
        isLoading: false,
        isError: false,
        refetch: mocks.refetchChecklist,
      };
    }
    if (key[0] === 'validation') {
      return { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
}));

vi.mock('@/features/documents/DocumentUpload', () => ({
  DocumentUpload: () => <div>Upload de documento</div>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('DraftBLTab audited checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.patch.mockResolvedValue({});
    mocks.refetchChecklist.mockResolvedValue({});
  });

  it('shows the shared operator attribution and persists a reopened item through the API', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <DraftBLTab processId="264" />
      </QueryClientProvider>,
    );

    expect(screen.getByText('1/11 itens (9%)')).toBeInTheDocument();
    expect(screen.getByText(/Operadora QA/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Draft Recebido/ }));

    await waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith('/api/processes/264/draft-bl-checklist', {
        key: 'draftReceivedOk',
        checked: false,
      });
      expect(mocks.refetchChecklist).toHaveBeenCalledOnce();
    });
  });
});
