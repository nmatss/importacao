import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockRefetch = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(),
}));

import { useApiQuery } from '@/shared/hooks/useApi';
import { FollowUpTab } from './FollowUpTab';

describe('FollowUpTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a retryable error instead of an empty tracking state when the API fails', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('offline'),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiQuery>);

    render(<FollowUpTab processId="42" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar o acompanhamento/i);
    screen.getByRole('button', { name: /Tentar novamente/i }).click();
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it('shows every persisted follow-up milestone, including the BL NCM check', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        id: 1,
        processId: 42,
        documentsReceivedAt: null,
        preInspectionAt: null,
        savedToFolderAt: null,
        ncmVerifiedAt: null,
        ncmBlCheckedAt: '2026-07-10T12:00:00.000Z',
        freightBlCheckedAt: null,
        espelhoBuiltAt: null,
        invoiceSentFeniciaAt: null,
        espelhoGeneratedAt: null,
        signaturesCollectedAt: null,
        signedDocsSentAt: null,
        sentToFeniciaAt: null,
        diDraftAt: null,
        liSubmittedAt: null,
        liApprovedAt: null,
        liDeadline: null,
        overallProgress: 7,
        notes: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-10T12:00:00.000Z',
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useApiQuery>);

    render(<FollowUpTab processId="42" />);

    expect(screen.getByText('NCM BL conferido')).toBeInTheDocument();
    expect(screen.getByText('Frete BL conferido')).toBeInTheDocument();
    expect(screen.getByText('Rascunho DI')).toBeInTheDocument();
  });
});
