import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProcessCreatePage } from './ProcessCreatePage';
import { MockAuthProvider } from '@/test/mocks/auth';

// Mock navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return { ...original, useNavigate: () => mockNavigate };
});

// Mock API mutation hook
vi.mock('@/shared/hooks/useApi', () => ({
  useApiMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <MockAuthProvider>
          <ProcessCreatePage />
        </MockAuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('ProcessCreatePage', () => {
  it('renders form fields', () => {
    renderPage();
    // "Novo Processo" appears in heading and document title
    const elements = screen.getAllByText(/Novo Processo/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('shows validation error when processCode is empty on submit', async () => {
    const user = userEvent.setup();
    renderPage();

    // Find and click submit button
    const submitBtn = screen.getByRole('button', { name: /Criar Processo/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Codigo do processo e obrigatorio/i)).toBeInTheDocument();
    });
  });

  it('shows validation error when brand is not selected', async () => {
    const user = userEvent.setup();
    renderPage();

    const codeInput = screen.getByPlaceholderText(/IMP-2024-001/i);
    await user.type(codeInput, 'TEST-001');

    const submitBtn = screen.getByRole('button', { name: /Criar Processo/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Selecione a marca/i)).toBeInTheDocument();
    });
  });

  it('navigates back when back button clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const backBtn = screen.getByLabelText(/Voltar para lista de processos/i);
    await user.click(backBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/importacao/processos');
  });
});
