import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MockAuthProvider, MockUnauthProvider, mockUser } from '@/test/mocks/auth';

// Os layouts e as paginas nao sao o objeto deste teste — so o roteamento.
vi.mock('@/shared/components/ImportacaoLayout', () => ({
  ImportacaoLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/shared/components/CertificacoesLayout', () => ({
  CertificacoesLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/auth/LoginPage', () => ({
  LoginPage: () => <div>TELA DE LOGIN</div>,
}));
vi.mock('@/features/portal/PortalPage', () => ({
  PortalPage: () => <div>TELA DO PORTAL</div>,
}));

import { AppRoutes } from './routes';

function renderAt(path: string, role: 'admin' | 'analyst') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MockAuthProvider value={{ user: { ...mockUser, role } }}>
        <AppRoutes />
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Regressao: `/importacao/auditoria` era registrada sem o wrapper `AdminRoute`,
 * embora a rota da API seja admin-only. O analista chegava na tela e via um erro
 * de carregamento em vez de "acesso restrito".
 */
describe('rota /importacao/auditoria', () => {
  it('nega acesso ao analista com mensagem de acesso restrito', async () => {
    renderAt('/importacao/auditoria', 'analyst');

    expect(await screen.findByText('Acesso restrito')).toBeInTheDocument();
    expect(screen.getByText(/restrita a administradores/i)).toBeInTheDocument();
  });

  it('deixa o admin passar para a pagina', async () => {
    renderAt('/importacao/auditoria', 'admin');

    expect(screen.queryByText('Acesso restrito')).not.toBeInTheDocument();
  });
});

/**
 * Regressao: `/login` nao passava por guard nenhum, entao um usuario ja
 * autenticado que digitasse a URL via a tela de login de novo.
 */
describe('rota /login', () => {
  it('redireciona quem ja tem sessao para o portal', () => {
    renderAt('/login', 'analyst');

    expect(screen.getByText('TELA DO PORTAL')).toBeInTheDocument();
    expect(screen.queryByText('TELA DE LOGIN')).not.toBeInTheDocument();
  });

  it('mantem a tela de login para quem nao tem sessao', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <MockUnauthProvider>
          <AppRoutes />
        </MockUnauthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('TELA DE LOGIN')).toBeInTheDocument();
    expect(screen.queryByText('TELA DO PORTAL')).not.toBeInTheDocument();
  });
});
