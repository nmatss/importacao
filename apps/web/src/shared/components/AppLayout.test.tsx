import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Circle } from 'lucide-react';
import { MockAuthProvider } from '@/test/mocks/auth';

vi.mock('@/shared/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button">Tema</button>,
}));

vi.mock('@/shared/components/AssistantBubble', () => ({
  AssistantBubble: () => null,
}));

import { AppLayout } from './AppLayout';

function mockMobileViewport() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: '(min-width: 1024px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function LayoutFixture() {
  const [visible, setVisible] = useState(true);
  return visible ? (
    <AppLayout
      moduleKey="test"
      moduleName="Teste"
      accent="primary"
      navSections={[
        { label: 'Principal', items: [{ to: '/test', label: 'Início', icon: Circle }] },
      ]}
      navAriaLabel="Navegação de teste"
      checkHealth={() => Promise.resolve(true)}
      resolveHeader={() => ({ title: 'Página de teste' })}
    >
      <button type="button" onClick={() => setVisible(false)}>
        Conteúdo
      </button>
    </AppLayout>
  ) : null;
}

describe('AppLayout mobile navigation', () => {
  it('keeps the closed sidebar inert and restores focus after Escape', async () => {
    mockMobileViewport();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/test']}>
        <MockAuthProvider>
          <LayoutFixture />
        </MockAuthProvider>
      </MemoryRouter>,
    );

    const sidebar = screen.getByRole('complementary', { hidden: true });
    const openButton = screen.getByRole('button', { name: 'Abrir menu' });
    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    expect(sidebar).toHaveAttribute('inert');

    await user.click(openButton);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fechar menu' })).toHaveFocus());
    expect(sidebar).toHaveAttribute('aria-hidden', 'false');
    expect(sidebar).not.toHaveAttribute('inert');
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(openButton).toHaveFocus());
    expect(sidebar).toHaveAttribute('inert');
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' });
  });

  it('makes the main region a focusable skip-link destination', () => {
    mockMobileViewport();
    render(
      <MemoryRouter initialEntries={['/test']}>
        <MockAuthProvider>
          <LayoutFixture />
        </MockAuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
  });
});
