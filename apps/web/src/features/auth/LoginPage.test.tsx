import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { MockAuthProvider } from '@/test/mocks/auth';

// Google OAuth is browser-only; mock it
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess, onError }: { onSuccess: (r: { credential: string }) => void; onError: () => void }) => (
    <button
      data-testid="google-login-btn"
      onClick={() => onSuccess({ credential: 'mock-credential' })}
    >
      Login com Google
    </button>
  ),
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderLoginPage(authOverrides = {}) {
  return render(
    <MemoryRouter>
      <MockAuthProvider value={authOverrides}>
        <LoginPage />
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    renderLoginPage();
    expect(screen.getByText(/Bem-vindo de volta/i)).toBeInTheDocument();
  });

  it('shows Google login button when not loading', () => {
    renderLoginPage();
    expect(screen.getByTestId('google-login-btn')).toBeInTheDocument();
  });

  it('shows loading spinner after clicking login button', async () => {
    const loginWithGoogle = vi.fn(() => new Promise(() => {})); // never resolves = stays loading
    renderLoginPage({ loginWithGoogle });

    const btn = screen.getByTestId('google-login-btn');
    btn.click();

    await screen.findByText(/Autenticando/i);
  });

  it('calls loginWithGoogle when Google button clicked', async () => {
    const loginWithGoogle = vi.fn().mockResolvedValue(undefined);
    renderLoginPage({ loginWithGoogle });

    const btn = screen.getByTestId('google-login-btn');
    btn.click();

    await vi.waitFor(() => {
      expect(loginWithGoogle).toHaveBeenCalledWith('mock-credential');
    });
  });

  it('shows error message on login failure', async () => {
    const loginWithGoogle = vi.fn().mockRejectedValue(new Error('Conta não permitida'));
    renderLoginPage({ loginWithGoogle });

    const btn = screen.getByTestId('google-login-btn');
    btn.click();

    await screen.findByText(/Conta não permitida/i);
  });
});
