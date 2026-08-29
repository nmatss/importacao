import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/hooks/useApi', () => ({ useApiQuery: vi.fn() }));

import { useApiQuery } from '@/shared/hooks/useApi';
import { AuditLogPage } from './AuditLogPage';

const mockedUseApiQuery = vi.mocked(useApiQuery);

const users = [
  { id: 1, name: 'Admin Um' },
  { id: 2, name: 'Analista Dois' },
];

const logs = {
  data: [
    {
      id: 1,
      userId: 2,
      userName: 'Analista Dois',
      action: 'update',
      entityType: 'process',
      entityId: 5,
      details: null,
      ipAddress: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    },
  ],
  pagination: { total: 1, page: 1, limit: 20, pages: 1 },
};

function renderPage() {
  mockedUseApiQuery.mockImplementation(((_key: unknown, url: string) => ({
    data: url.startsWith('/api/auth/users') ? users : logs,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })) as unknown as typeof useApiQuery);

  return render(
    <MemoryRouter>
      <AuditLogPage />
    </MemoryRouter>,
  );
}

/**
 * Regressao: a API sempre aceitou `userId` (audit/schema.ts), mas a tela so
 * oferecia Acao, Tipo e periodo — e "quem fez" e a pergunta mais frequente.
 */
describe('AuditLogPage filtro por usuário', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('envia userId na query ao selecionar um usuário', async () => {
    renderPage();

    const select = screen.getByLabelText('Usuário');
    expect(screen.getByRole('option', { name: 'Analista Dois' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '2' } });

    await waitFor(() =>
      expect(
        mockedUseApiQuery.mock.calls
          .map(([, url]) => url)
          .some((url) => url.startsWith('/api/audit/logs') && url.includes('userId=2')),
      ).toBe(true),
    );
  });

  it('não envia userId quando o filtro está em "Todos os usuários"', () => {
    renderPage();

    const auditUrls = mockedUseApiQuery.mock.calls
      .map(([, url]) => url)
      .filter((url) => url.startsWith('/api/audit/logs'));
    expect(auditUrls.length).toBeGreaterThan(0);
    expect(auditUrls.every((url) => !url.includes('userId='))).toBe(true);
  });
});
