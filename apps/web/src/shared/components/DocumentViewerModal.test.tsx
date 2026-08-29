import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocumentViewerModal } from './DocumentViewerModal';

/**
 * Regressao: a ref chamada `closeButtonRef` estava no botao BAIXAR e era ela que
 * ia como `initialFocusRef` do ModalPortal. Ao abrir o visualizador o foco caia
 * em "Baixar" e um Enter reflexo disparava o download.
 */
describe('DocumentViewerModal foco inicial', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        redirected: false,
        blob: async () => new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
      }),
    );
    // jsdom nao implementa createObjectURL/revokeObjectURL.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:mock'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('foca o botao de fechar, nunca o de baixar', async () => {
    render(<DocumentViewerModal documentId={7} fileName="bl.pdf" onClose={vi.fn()} />);

    const closeButton = await screen.findByRole('button', { name: 'Fechar visualizador' });
    await waitFor(() => expect(closeButton).toHaveFocus());
    expect(screen.getByRole('button', { name: /Baixar/ })).not.toHaveFocus();
  });
});
