import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchMarketplaceItems: vi.fn(),
    startMarketplaceAudit: vi.fn(),
    fetchMarketplaceAudit: vi.fn(),
  };
});

import {
  fetchMarketplaceItems,
  startMarketplaceAudit,
  type CertMarketplaceItem,
} from '@/shared/lib/cert-api-client';
import CertMarketplacePage from './CertMarketplacePage';

const mockedItems = vi.mocked(fetchMarketplaceItems);
const mockedStart = vi.mocked(startMarketplaceAudit);

function item(overrides: Partial<CertMarketplaceItem> = {}): CertMarketplaceItem {
  return {
    id: 'i1',
    vtex_product_id: 'p1',
    seller_id: 'lojaparceira',
    seller_name: 'Loja Parceira',
    name: 'Puzzle 60 pecas Aventura',
    url: 'https://example.invalid/puzzle/p',
    pieces: 60,
    cert_text: null,
    verdict: 'NAO_OK',
    reason: '60 pecas e nenhuma informacao no site',
    checked_at: '2026-09-11T12:00:00+00:00',
    run_id: 'run-1',
    ...overrides,
  };
}

describe('CertMarketplacePage', () => {
  beforeEach(() => {
    mockedItems.mockReset();
    mockedStart.mockReset();
    mockedItems.mockResolvedValue({
      items: [item()],
      run_id: 'run-1',
      checked_at: '2026-09-11T12:00:00+00:00',
      summary: { NAO_OK: 2, REVISAR: 17, NAO_EXIGE: 108 },
    });
  });

  it('mostra o veredito em portugues, nunca a chave tecnica', async () => {
    render(<CertMarketplacePage />);

    await waitFor(() => expect(screen.getByText('Puzzle 60 pecas Aventura')).toBeInTheDocument());
    expect(screen.getAllByText(/Não conforme/).length).toBeGreaterThan(0);
    expect(screen.queryByText('NAO_OK')).not.toBeInTheDocument();
  });

  it('usa o resumo da execucao inteira nos contadores, nao a pagina filtrada', async () => {
    render(<CertMarketplacePage />);

    // 1 item na tabela, mas 2 não conformes na execução.
    await waitFor(() => expect(screen.getByText(/Não conforme \(2\)/)).toBeInTheDocument());
    expect(screen.getByText(/Revisar \(17\)/)).toBeInTheDocument();
    expect(screen.getByText(/Todos \(127\)/)).toBeInTheDocument();
  });

  it('envia o filtro de veredito para a API', async () => {
    const user = userEvent.setup();
    render(<CertMarketplacePage />);
    await waitFor(() => expect(mockedItems).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Revisar \(17\)/ }));

    await waitFor(() => expect(mockedItems).toHaveBeenLastCalledWith({ verdict: 'REVISAR' }));
  });

  it('mostra travessao quando a quantidade de pecas e desconhecida', async () => {
    mockedItems.mockResolvedValue({
      items: [item({ pieces: null, verdict: 'REVISAR', reason: 'Sem numero de pecas' })],
      run_id: 'run-1',
      checked_at: null,
      summary: { REVISAR: 1 },
    });

    render(<CertMarketplacePage />);

    // Peças e texto de certificação: os dois ausentes viram travessão, nunca 0.
    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(2));
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('diferencia "sem itens" de "API indisponivel"', async () => {
    mockedItems.mockRejectedValue(new Error('Erro na API: 503'));

    render(<CertMarketplacePage />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('503'));
  });

  it('avisa quando a auditoria nao pode ser disparada', async () => {
    const user = userEvent.setup();
    mockedStart.mockRejectedValue(new Error('Erro na API: 403 Forbidden'));
    render(<CertMarketplacePage />);
    await waitFor(() => expect(mockedItems).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Rodar auditoria/ }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Rodar auditoria/ })).toBeEnabled(),
    );
    expect(mockedStart).toHaveBeenCalledOnce();
  });
});
