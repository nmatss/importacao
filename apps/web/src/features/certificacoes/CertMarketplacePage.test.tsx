import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchMarketplaceItems: vi.fn(),
    startMarketplaceAudit: vi.fn(),
    fetchMarketplaceAudit: vi.fn(),
  };
});

import { toast } from 'sonner';
import {
  fetchMarketplaceAudit,
  fetchMarketplaceItems,
  startMarketplaceAudit,
  type CertMarketplaceItem,
} from '@/shared/lib/cert-api-client';
import CertMarketplacePage from './CertMarketplacePage';

const mockedItems = vi.mocked(fetchMarketplaceItems);
const mockedStart = vi.mocked(startMarketplaceAudit);
const mockedAudit = vi.mocked(fetchMarketplaceAudit);
const mockedToast = vi.mocked(toast);

/** Dispara a auditoria e avança o relógio até o primeiro poll responder. */
async function runAuditUntilFirstPoll() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<CertMarketplacePage />);
  await waitFor(() => expect(mockedItems).toHaveBeenCalled());
  await user.click(screen.getByRole('button', { name: /Rodar auditoria/ }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3100);
  });
  await waitFor(() => expect(mockedAudit).toHaveBeenCalled());
}

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
    mockedAudit.mockReset();
    mockedToast.success.mockReset();
    mockedToast.error.mockReset();
    mockedToast.warning.mockReset();
    mockedItems.mockResolvedValue({
      items: [item()],
      run_id: 'run-1',
      checked_at: '2026-09-11T12:00:00+00:00',
      summary: { NAO_OK: 2, REVISAR: 17, NAO_EXIGE: 108 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
  // K7 — categoria vazia é erro explícito, nunca "Auditoria concluída".
  it('mostra o erro legivel da API quando a categoria veio vazia', async () => {
    mockedStart.mockResolvedValue({ run_id: 'run-2', status: 'running' });
    mockedAudit.mockResolvedValue({
      run_id: 'run-2',
      status: 'error',
      error: 'EmptyCategoryError',
      message: 'A loja não devolveu nenhum produto para a categoria de quebra-cabeças.',
    });

    await runAuditUntilFirstPoll();

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        expect.stringContaining('não devolveu nenhum produto'),
      ),
    );
    expect(mockedToast.success).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('não devolveu nenhum produto');
  });

  it('nao chama de concluida a auditoria que nao achou item de seller terceiro', async () => {
    mockedStart.mockResolvedValue({ run_id: 'run-2', status: 'running' });
    mockedAudit.mockResolvedValue({
      run_id: 'run-2',
      status: 'completed',
      total: 0,
      scanned: 40,
      unverified: 0,
    });

    await runAuditUntilFirstPoll();

    await waitFor(() => expect(mockedToast.warning).toHaveBeenCalled());
    expect(mockedToast.success).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/40 produto/);
    expect(screen.getByRole('status')).toHaveTextContent(/auditoria anterior/);
  });

  it('avisa quantos itens nao puderam ser verificados', async () => {
    mockedStart.mockResolvedValue({ run_id: 'run-2', status: 'running' });
    mockedAudit.mockResolvedValue({
      run_id: 'run-2',
      status: 'completed',
      total: 12,
      scanned: 40,
      unverified: 3,
    });

    await runAuditUntilFirstPoll();

    await waitFor(() =>
      expect(mockedToast.warning).toHaveBeenCalledWith(expect.stringContaining('3 ')),
    );
  });

  it('confirma a auditoria concluida com itens', async () => {
    mockedStart.mockResolvedValue({ run_id: 'run-2', status: 'running' });
    mockedAudit.mockResolvedValue({
      run_id: 'run-2',
      status: 'completed',
      total: 12,
      scanned: 40,
      unverified: 0,
    });

    await runAuditUntilFirstPoll();

    await waitFor(() => expect(mockedToast.success).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // K8 — filtro sem resultado não apaga a data nem manda rodar de novo.
  it('mantem a data da ultima auditoria quando o filtro nao tem itens', async () => {
    mockedItems.mockResolvedValue({
      items: [],
      run_id: 'run-1',
      checked_at: '2026-09-11T12:00:00+00:00',
      summary: { NAO_OK: 7 },
    });

    render(<CertMarketplacePage />);

    await waitFor(() => expect(screen.getByText(/Última auditoria:/)).toBeInTheDocument());
    expect(
      screen.getByText(/Nenhum item com esta situação na última auditoria/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Rode a auditoria/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sem data de verificação/)).not.toBeInTheDocument();
  });

  it('so pede para rodar a auditoria quando nunca houve uma', async () => {
    mockedItems.mockResolvedValue({ items: [], run_id: null, checked_at: null, summary: {} });

    render(<CertMarketplacePage />);

    await waitFor(() => expect(screen.getByText(/Rode a auditoria/)).toBeInTheDocument());
    expect(screen.getByText(/Nenhuma auditoria executada ainda/)).toBeInTheDocument();
  });
  // K9 — a API devolve 409 quando outra aba já está auditando.
  it('explica que ja existe auditoria em andamento e libera o botao', async () => {
    const user = userEvent.setup();
    mockedStart.mockRejectedValue(
      new Error('Erro na API: Já existe uma auditoria em andamento. Aguarde ela terminar.'),
    );
    render(<CertMarketplacePage />);
    await waitFor(() => expect(mockedItems).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /Rodar auditoria/ }));

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        expect.stringContaining('auditoria em andamento'),
      ),
    );
    expect(screen.getByRole('button', { name: /Rodar auditoria/ })).toBeEnabled();
    expect(mockedAudit).not.toHaveBeenCalled();
  });
});
