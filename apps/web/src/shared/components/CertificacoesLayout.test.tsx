import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';

vi.mock('@/shared/lib/cert-api-client', () => ({
  checkCertApiHealth: vi.fn().mockResolvedValue({ connected: true, latencyMs: 1 }),
}));

vi.mock('@/shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock('@/shared/components/AssistantBubble', () => ({
  AssistantBubble: () => null,
}));

import { checkCertApiHealth } from '@/shared/lib/cert-api-client';
import { CertificacoesLayout } from './CertificacoesLayout';

function renderLayout(role: 'admin' | 'analyst') {
  return render(
    <MemoryRouter initialEntries={['/certificacoes']}>
      <MockAuthProvider value={{ user: { ...mockUser, role } }}>
        <CertificacoesLayout>
          <div>Conteúdo de certificações</div>
        </CertificacoesLayout>
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

describe('CertificacoesLayout permissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps operational navigation available and hides administrative actions from analysts', () => {
    renderLayout('analyst');

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Validação' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Produtos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Relatórios' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cadastrar Certificado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Agendamentos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument();
  });

  it('keeps administrative navigation visible to administrators', () => {
    renderLayout('admin');

    expect(screen.getByRole('link', { name: 'Cadastrar Certificado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agendamentos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
    expect(checkCertApiHealth).toHaveBeenCalled();
  });
});
