import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MockAuthProvider, mockUser } from '@/test/mocks/auth';

vi.mock('@/shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock('@/shared/components/AssistantBubble', () => ({
  AssistantBubble: () => null,
}));

import { ImportacaoLayout } from './ImportacaoLayout';

function renderLayout(role: 'admin' | 'analyst') {
  return render(
    <MemoryRouter initialEntries={['/importacao/dashboard']}>
      <MockAuthProvider value={{ user: { ...mockUser, role } }}>
        <ImportacaoLayout>
          <div>conteudo</div>
        </ImportacaoLayout>
      </MockAuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Regressao: `/importacao/auditoria` e admin-only no servidor, mas o item de menu
 * nao tinha `adminOnly`. O analista via "Auditoria", clicava, a query voltava 403
 * e a tela mostrava "Erro ao carregar os registros de auditoria".
 */
describe('ImportacaoLayout menu de Auditoria', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('esconde Auditoria do analista', async () => {
    renderLayout('analyst');
    // Deixa o health-check do shell resolver antes das asserções.
    await screen.findByText('API online');

    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument();
    // Um item nao-admin da mesma secao continua visivel.
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument();
  });

  it('mostra Auditoria para o admin', async () => {
    renderLayout('admin');
    await screen.findByText('API online');

    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
  });
});
