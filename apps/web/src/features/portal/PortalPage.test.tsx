import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MockAuthProvider } from '@/test/mocks/auth';
import { PortalPage } from './PortalPage';

vi.mock('@/shared/hooks/useApi', () => ({
  useApiQuery: vi.fn(() => ({
    data: {
      activeProcesses: 3,
      overdueProcesses: 0,
      completedThisMonth: 1,
    },
    isLoading: false,
  })),
}));

vi.mock('@/shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock('@/shared/lib/cert-api-client', () => ({
  fetchCertStats: vi.fn(),
  checkCertApiHealth: vi.fn(),
}));

import { fetchCertStats, checkCertApiHealth } from '@/shared/lib/cert-api-client';

const mockedFetchCertStats = vi.mocked(fetchCertStats);
const mockedCheckCertApiHealth = vi.mocked(checkCertApiHealth);

function renderPortal(role: 'admin' | 'analyst') {
  return render(
    <MemoryRouter>
      <MockAuthProvider
        value={{
          user: {
            id: '1',
            name: role === 'admin' ? 'Admin User' : 'Mariana Santos',
            email: role === 'admin' ? 'admin@grupounico.com' : 'mariana.santos@grupounico.com',
            role,
          },
        }}
      >
        <PortalPage />
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

describe('PortalPage auth-sensitive cert-api calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    mockedFetchCertStats.mockResolvedValue({
      total_products: 10,
      last_run: {
        date: '2026-06-25',
        total: 10,
        ok: 8,
        missing: 1,
        inconsistent: 1,
        not_found: 0,
      },
    });
    mockedCheckCertApiHealth.mockResolvedValue({ connected: true, latencyMs: 12 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps cert-api stats enabled for analyst users', async () => {
    renderPortal('analyst');

    await screen.findByText(/Mariana Santos/i);
    expect(screen.getAllByText(/Pagamentos SYDLE/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(mockedFetchCertStats).toHaveBeenCalledTimes(1));
    expect(mockedCheckCertApiHealth).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Acessar Certificações/i)).toBeInTheDocument();
    expect(screen.queryByText(/Acesso restrito/i)).not.toBeInTheDocument();
  });

  it('keeps cert-api stats enabled for admin users', async () => {
    renderPortal('admin');

    await waitFor(() => expect(mockedFetchCertStats).toHaveBeenCalledTimes(1));
    expect(mockedCheckCertApiHealth).toHaveBeenCalledTimes(1);
  });
});
