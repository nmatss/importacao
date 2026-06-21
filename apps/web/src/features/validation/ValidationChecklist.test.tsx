import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MockAuthProvider } from '@/test/mocks/auth';

// Hoist mocks before any imports that use them
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/shared/lib/api-client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const mockRefetch = vi.fn();
const mockMutate = vi.fn();

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(() => ({
    data: null,
    isLoading: false,
    refetch: mockRefetch,
    error: null,
    isError: false,
  })),
  useApiMutation: vi.fn(() => ({
    mutate: mockMutate,
    isPending: false,
  })),
}));

// Import after mocks are set up
import { ValidationChecklist } from './ValidationChecklist';
import { useApiQuery } from '@/shared/hooks/useApi';
import { api } from '@/shared/lib/api-client';

const failedChecks = [
  {
    id: 3,
    checkName: 'gross-weight-match',
    status: 'failed' as const,
    message: 'Peso bruto divergente',
  },
];

const correctionDraft = {
  id: 99,
  processId: 1,
  recipient: 'KIOM',
  recipientEmail: 'kiom@example.com',
  subject: 'Correção documental',
  body: '<p>Favor corrigir os dados.</p>',
  status: 'draft',
};

function renderChecklist(
  checks:
    | {
        id: number;
        checkName: string;
        status: 'passed' | 'failed' | 'warning' | 'skipped';
        message?: string;
        resolvedManually?: boolean;
        resolvedBy?: string | number | null;
        resolvedAt?: string | null;
        expectedValue?: string;
        actualValue?: string;
      }[]
    | null = null,
) {
  vi.mocked(useApiQuery).mockImplementation((queryKey: unknown) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : null;
    return {
      data: key === 'email-signatures' ? [] : checks,
      isLoading: false,
      refetch: mockRefetch,
      error: null,
      isError: false,
    } as unknown as ReturnType<typeof useApiQuery>;
  });

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockAuthProvider>
          <ValidationChecklist processId="1" />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ValidationChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing when no data', () => {
    renderChecklist(null);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with passed checks', () => {
    renderChecklist([{ id: 1, checkName: 'check_invoice_number', status: 'passed' }]);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with failed check', () => {
    renderChecklist([
      { id: 2, checkName: 'check_invoice_date', status: 'failed', message: 'Data inválida' },
    ]);
    expect(document.body).toBeTruthy();
  });

  it('renders without crashing with mixed statuses', () => {
    renderChecklist([
      { id: 1, checkName: 'check_invoice_number', status: 'passed' },
      { id: 2, checkName: 'check_invoice_date', status: 'failed', message: 'Data inválida' },
      { id: 3, checkName: 'check_weight', status: 'warning' },
      { id: 4, checkName: 'check_other', status: 'skipped' },
    ]);
    expect(document.body).toBeTruthy();
  });

  it('separates accepted failures from open failures and correction actions', () => {
    renderChecklist([
      { id: 1, checkName: 'ports-match', status: 'passed' },
      {
        id: 2,
        checkName: 'fob-calculation',
        status: 'failed',
        message: 'FOB aceito operacionalmente',
        resolvedManually: true,
        resolvedBy: 4,
        resolvedAt: '2026-06-08T15:41:00.000Z',
      },
    ]);

    expect(screen.getByRole('button', { name: /Falhas: 0/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceitos: 1/i })).toBeInTheDocument();
    expect(
      screen.getByText(/2 de 2 verificações acionáveis aprovadas ou aceitas/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Gerar e-mail correcao/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Falhas: 0/i }));

    expect(screen.getByText(/Nenhuma falha aberta neste processo/i)).toBeInTheDocument();
  });

  it('highlights skipped checks as blocked in progress without counting them as actionable', () => {
    renderChecklist([
      { id: 1, checkName: 'ports-match', status: 'passed' },
      {
        id: 2,
        checkName: 'dates-match',
        status: 'skipped',
        message: 'Bill of Lading ausente.',
      },
    ]);

    expect(
      screen.getByText(/1 de 1 verificações acionáveis aprovadas ou aceitas/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 bloqueada/i)).toBeInTheDocument();
    expect(screen.getByText(/Bloqueados por documento ausente/i)).toBeInTheDocument();
  });

  it('shows correction actions only for unresolved failures', () => {
    renderChecklist([
      { id: 1, checkName: 'ports-match', status: 'passed' },
      {
        id: 2,
        checkName: 'fob-calculation',
        status: 'failed',
        message: 'FOB aceito operacionalmente',
        resolvedManually: true,
      },
      {
        id: 3,
        checkName: 'gross-weight-match',
        status: 'failed',
        message: 'Peso bruto divergente',
      },
    ]);

    expect(screen.getByRole('button', { name: /Falhas: 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceitos: 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gerar e-mail correcao/i })).toBeInTheDocument();
  });

  it('focuses the draft modal, closes it with Escape and restores opener focus', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(correctionDraft);
    renderChecklist(failedChecks);

    const opener = screen.getByRole('button', { name: /Gerar e-mail correcao/i });
    opener.focus();
    fireEvent.click(opener);

    expect(await screen.findByRole('dialog', { name: /E-mail de Correcao/i })).toBeInTheDocument();
    const recipient = screen.getByLabelText(/Destinatário/i);
    await waitFor(() => expect(recipient).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /E-mail de Correcao/i })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps Tab navigation inside the draft modal', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(correctionDraft);
    renderChecklist(failedChecks);

    fireEvent.click(screen.getByRole('button', { name: /Gerar e-mail correcao/i }));

    await screen.findByRole('dialog', { name: /E-mail de Correcao/i });
    const recipient = screen.getByLabelText(/Destinatário/i);
    const closeButton = screen.getByLabelText(/Fechar modal/i);
    const sendButton = screen.getByRole('button', { name: /Enviar E-mail/i });
    await waitFor(() => expect(recipient).toHaveFocus());

    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(sendButton).toHaveFocus();

    sendButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('renders the reconciled item-presence anomaly pointing to the canonical comparison list', async () => {
    // Backend reconciles the AI's fuzzy "7 itens nao encontrados" down to the
    // deterministic count and re-emits it under the canonical items.unmatched
    // field. The panel must show that description and point to the Comparativo
    // Geral list — never an independent number that could disagree (7 vs 1).
    vi.mocked(api.post).mockResolvedValueOnce({
      anomalies: [
        {
          field: 'items.unmatched',
          description:
            '1 item no Packing List sem correspondencia na Invoice (comparacao deterministica).',
          severity: 'medium',
        },
      ],
    });
    renderChecklist([{ id: 1, checkName: 'ports-match', status: 'passed' }]);

    fireEvent.click(screen.getByRole('button', { name: /Analisar divergências/i }));

    expect(await screen.findByText(/Anomalias Detectadas pela IA/i)).toBeInTheDocument();
    // Canonical description from the deterministic comparison is shown.
    expect(
      screen.getByText(
        /1 item no Packing List sem correspondencia na Invoice \(comparacao deterministica\)/i,
      ),
    ).toBeInTheDocument();
    // It points back to the single canonical list instead of the raw field name.
    expect(screen.getByText('Itens sem correspondencia')).toBeInTheDocument();
    expect(
      screen.getByText(/Ver a lista completa em "Itens no Packing List sem correspondencia/i),
    ).toBeInTheDocument();
    // The header makes clear this surface does not report its own number.
    expect(screen.getByText(/esta lista nao reporta um numero proprio/i)).toBeInTheDocument();
  });

  it('treats the Invoice-direction unmatched variant (items.unmatched.invoice) as an item anomaly', async () => {
    // The backend emits the Invoice→PL direction under `items.unmatched.invoice`.
    // The panel must detect it by prefix and give it the same friendly grouped
    // treatment — pointing to the Comparativo Geral list, NOT the raw field name
    // or an independent percentage.
    vi.mocked(api.post).mockResolvedValueOnce({
      anomalies: [
        {
          field: 'items.unmatched.invoice',
          description:
            '1 item na Invoice sem correspondencia no Packing List (comparacao deterministica).',
          severity: 'medium',
          confidence: 0.9,
        },
      ],
    });
    renderChecklist([{ id: 1, checkName: 'ports-match', status: 'passed' }]);

    fireEvent.click(screen.getByRole('button', { name: /Analisar divergências/i }));

    expect(await screen.findByText(/Anomalias Detectadas pela IA/i)).toBeInTheDocument();
    // Friendly grouped label is shown instead of the raw field key.
    expect(screen.getByText('Itens sem correspondencia')).toBeInTheDocument();
    expect(screen.queryByText('items.unmatched.invoice')).not.toBeInTheDocument();
    // It points back to the single canonical list.
    expect(
      screen.getByText(/Ver a lista completa em "Itens no Packing List sem correspondencia/i),
    ).toBeInTheDocument();
    // No independent confidence percentage is surfaced for the reconciled signal.
    expect(screen.queryByText('90%')).not.toBeInTheDocument();
  });

  it('saves the current draft body HTML even when the editor has not blurred', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(correctionDraft);
    vi.mocked(api.patch).mockResolvedValueOnce({
      ...correctionDraft,
      body: '<p>Conteúdo ajustado</p>',
    });
    renderChecklist(failedChecks);

    fireEvent.click(screen.getByRole('button', { name: /Gerar e-mail correcao/i }));

    const bodyEditor = await screen.findByRole('textbox', { name: /Corpo do E-mail/i });
    bodyEditor.innerHTML = '<p>Conteúdo ajustado</p>';
    fireEvent.input(bodyEditor);
    fireEvent.click(screen.getByRole('button', { name: /Salvar Rascunho/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/communications/99/draft', {
        subject: 'Correção documental',
        body: '<p>Conteúdo ajustado</p>',
        recipientEmail: 'kiom@example.com',
      }),
    );
  });
});
