import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/shared/contexts/AuthContext';
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
    let capturedAuth: ReturnType<typeof useAuth> | null = null;

    renderWithAuth((auth) => {
      capturedAuth = auth;
    });

    await waitFor(() => expect(capturedAuth?.loading).toBe(false));
    expect(capturedAuth?.user).toBeNull();
  });

  it('restores user from token in localStorage', async () => {
    localStorage.setItem('importacao_token', mockToken);
    vi.mocked(api.get).mockResolvedValue(mockUser);

    let capturedAuth: ReturnType<typeof useAuth> | null = null;
    renderWithAuth((auth) => {
      capturedAuth = auth;
    });

    await waitFor(() => expect(capturedAuth?.loading).toBe(false));
    expect(capturedAuth?.user?.email).toBe('test@grupounico.com');
  });

  it('removes token from localStorage on auth/me failure', async () => {
    localStorage.setItem('importacao_token', 'invalid-token');
    vi.mocked(api.get).mockRejectedValue(new Error('Unauthorized'));

    let capturedAuth: ReturnType<typeof useAuth> | null = null;
    renderWithAuth((auth) => {
      capturedAuth = auth;
    });

    await waitFor(() => expect(capturedAuth?.loading).toBe(false));
    expect(localStorage.getItem('importacao_token')).toBeNull();
    expect(capturedAuth?.user).toBeNull();
  });

  it('login sets token and user', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('no token'));
    vi.mocked(api.post).mockResolvedValue({ token: mockToken, user: mockUser });

    let capturedAuth: ReturnType<typeof useAuth> | null = null;
    renderWithAuth((auth) => {
      capturedAuth = auth;
    });

    await waitFor(() => expect(capturedAuth?.loading).toBe(false));

    await act(async () => {
      await capturedAuth?.login('test@grupounico.com', 'password123');
    });

    expect(localStorage.getItem('importacao_token')).toBe(mockToken);
  });

  it('logout clears token and user', async () => {
    localStorage.setItem('importacao_token', mockToken);
    vi.mocked(api.get).mockResolvedValue(mockUser);

    let capturedAuth: ReturnType<typeof useAuth> | null = null;
    renderWithAuth((auth) => {
      capturedAuth = auth;
    });

    await waitFor(() => expect(capturedAuth?.loading).toBe(false));

    act(() => {
      capturedAuth?.logout();
    });

    expect(localStorage.getItem('importacao_token')).toBeNull();
  });
});
