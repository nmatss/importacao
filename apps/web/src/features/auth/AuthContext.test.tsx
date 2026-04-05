import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, type AuthContextValue } from '@/shared/contexts/AuthContext';
import { useAuth } from '@/shared/hooks/useAuth';

// Mock the API client
vi.mock('@/shared/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/shared/lib/api-client';

const mockUser = { id: '1', name: 'Test', email: 'test@grupounico.com', role: 'analyst' };
const mockToken = 'mock-jwt-token';

function TestComponent({ onMount }: { onMount: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onMount(auth);
  return <div data-testid="user">{auth.user?.name ?? 'not logged in'}</div>;
}

function renderWithAuth(onMount: (auth: ReturnType<typeof useAuth>) => void) {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <TestComponent onMount={onMount} />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('starts with null user when no token in localStorage', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('no token'));
    const captured: { auth: AuthContextValue | null } = { auth: null };

    renderWithAuth((auth) => {
      captured.auth = auth;
    });

    await waitFor(() => expect(captured.auth?.loading).toBe(false));
    expect(captured.auth?.user).toBeNull();
  });

  it('restores user from token in localStorage', async () => {
    localStorage.setItem('importacao_token', mockToken);
    vi.mocked(api.get).mockResolvedValue(mockUser);

    const captured: { auth: AuthContextValue | null } = { auth: null };
    renderWithAuth((auth) => {
      captured.auth = auth;
    });

    await waitFor(() => expect(captured.auth?.loading).toBe(false));
    expect(captured.auth?.user?.email).toBe('test@grupounico.com');
  });

  it('removes token from localStorage on auth/me failure', async () => {
    localStorage.setItem('importacao_token', 'invalid-token');
    vi.mocked(api.get).mockRejectedValue(new Error('Unauthorized'));

    const captured: { auth: AuthContextValue | null } = { auth: null };
    renderWithAuth((auth) => {
      captured.auth = auth;
    });

    await waitFor(() => expect(captured.auth?.loading).toBe(false));
    expect(localStorage.getItem('importacao_token')).toBeNull();
    expect(captured.auth?.user).toBeNull();
  });

  it('login sets token and user', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('no token'));
    vi.mocked(api.post).mockResolvedValue({ token: mockToken, user: mockUser });

    const captured: { auth: AuthContextValue | null } = { auth: null };
    renderWithAuth((auth) => {
      captured.auth = auth;
    });

    await waitFor(() => expect(captured.auth?.loading).toBe(false));

    await act(async () => {
      await captured.auth?.login('test@grupounico.com', 'password123');
    });

    expect(localStorage.getItem('importacao_token')).toBe(mockToken);
  });

  it('logout clears token and user', async () => {
    localStorage.setItem('importacao_token', mockToken);
    vi.mocked(api.get).mockResolvedValue(mockUser);

    const captured: { auth: AuthContextValue | null } = { auth: null };
    renderWithAuth((auth) => {
      captured.auth = auth;
    });

    await waitFor(() => expect(captured.auth?.loading).toBe(false));

    act(() => {
      captured.auth?.logout();
    });

    expect(localStorage.getItem('importacao_token')).toBeNull();
  });
});
