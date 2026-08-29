import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/shared/lib/cert-api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/lib/cert-api-client')>();
  return {
    ...actual,
    fetchCertProductDetail: vi.fn(),
    fetchCertificates: vi.fn(),
    lookupCertificateLinx: vi.fn(),
    createCertificate: vi.fn(),
    retryCertificateLinx: vi.fn(),
    downloadCertificatePdf: vi.fn(),
  };
});

import {
  fetchCertProductDetail,
  fetchCertificates,
  lookupCertificateLinx,
} from '@/shared/lib/cert-api-client';
import CertCadastroPage, { todayLocalIso } from './CertCadastroPage';

const mockedFetchCertificates = vi.mocked(fetchCertificates);
const mockedFetchProduct = vi.mocked(fetchCertProductDetail);
const mockedLookup = vi.mocked(lookupCertificateLinx);

describe('CertCadastroPage Linx lookup', () => {
  beforeEach(() => {
    mockedFetchCertificates.mockReset();
    mockedFetchProduct.mockReset();
    mockedLookup.mockReset();
    mockedFetchCertificates.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 10,
      total_pages: 1,
    });
    mockedLookup.mockResolvedValue({
      status: 'found',
      sku: '100400496',
      brand: 'puket',
      produto_codigo: '100400496',
      validade_certificado: '2027-08-11',
      vencimento_licenciamento: null,
      properties: {
        validade_certificado: {
          property_code: '00224',
          raw_value: '11/08/2027',
          state: 'found',
        },
        vencimento_licenciamento: {
          property_code: '00225',
          raw_value: '01/01/1900',
          state: 'empty',
        },
      },
    });
    mockedFetchProduct.mockResolvedValue({
      sku: '100400496',
      brand: 'Puket',
      numero_certificado: '006083/2024',
    });
  });

  it('consults Linx and fills only empty date fields', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.selectOptions(screen.getByLabelText(/Marca \/ Loja/i), 'puket');
    await user.type(screen.getByLabelText(/SKU do produto/i), '100400496');
    await user.type(screen.getByLabelText(/Vencimento do Licenciamento/i), '2028-01-20');
    await user.click(screen.getByRole('button', { name: /Buscar no Linx/i }));

    await waitFor(() => expect(mockedLookup).toHaveBeenCalledWith('puket', '100400496'));
    expect(screen.getByLabelText(/Validade do Certificado/i)).toHaveValue('2027-08-11');
    expect(screen.getByLabelText(/Vencimento do Licenciamento/i)).toHaveValue('2028-01-20');
    expect(screen.getByLabelText(/Nº do Certificado/i)).toHaveValue('006083/2024');
    expect(screen.getByText(/prop 00224/i)).toBeInTheDocument();
    expect(screen.getByText(/prop 00225/i)).toBeInTheDocument();
  });

  it('discards a Linx response when the SKU changes while the lookup is pending', async () => {
    let resolveLookup!: (value: Awaited<ReturnType<typeof lookupCertificateLinx>>) => void;
    mockedLookup.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLookup = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    const skuInput = screen.getByLabelText(/SKU do produto/i);
    await user.type(skuInput, '100400496');
    await user.click(screen.getByRole('button', { name: /Buscar no Linx/i }));
    await user.clear(skuInput);
    await user.type(skuInput, 'NOVO-SKU');
    resolveLookup({
      status: 'found',
      sku: '100400496',
      brand: 'imaginarium',
      produto_codigo: '100400496',
      validade_certificado: '2027-08-11',
      vencimento_licenciamento: null,
      properties: {
        validade_certificado: {
          property_code: '00106',
          raw_value: '11/08/2027',
          state: 'found',
        },
        vencimento_licenciamento: {
          property_code: '00107',
          raw_value: null,
          state: 'empty',
        },
      },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Buscar no Linx/i })).toBeEnabled(),
    );
    expect(skuInput).toHaveValue('NOVO-SKU');
    expect(screen.getByLabelText(/Validade do Certificado/i)).toHaveValue('');
    expect(screen.queryByText(/dados atuais consultados/i)).not.toBeInTheDocument();
  });
});

// ── Item 3: "vazio" não é "indisponível" ────────────────────────────────────
describe('CertCadastroPage lista de certificados', () => {
  beforeEach(() => {
    mockedFetchCertificates.mockReset();
    mockedFetchProduct.mockReset();
    mockedLookup.mockReset();
  });

  it('mostra banner de erro com retry quando a listagem falha', async () => {
    mockedFetchCertificates.mockRejectedValue(new Error('Erro na API: 500'));
    render(<CertCadastroPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Não foi possível carregar os certificados/i);
    // Nunca a mensagem de lista vazia — a API caiu, não há "nenhum cadastrado".
    expect(screen.queryByText('Nenhum certificado cadastrado ainda.')).not.toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument();
  });

  it('diz "nenhum cadastrado" só quando a API responde com lista vazia', async () => {
    mockedFetchCertificates.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 10,
      total_pages: 1,
    });
    render(<CertCadastroPage />);

    expect(await screen.findByText('Nenhum certificado cadastrado ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('oferece "Reenviar ao Linx" também para linhas pending', async () => {
    mockedFetchCertificates.mockResolvedValue({
      items: [
        {
          id: 'c1',
          sku: 'SKU-PEND',
          brand: 'puket',
          linx_status: 'pending',
          validade_certificado: '2027-08-11',
        },
      ],
      total: 1,
      page: 1,
      per_page: 10,
      total_pages: 1,
    });
    render(<CertCadastroPage />);

    expect(await screen.findByText('SKU-PEND')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reenviar ao Linx/i })).toBeInTheDocument();
    // Data formatada, não ISO cru.
    expect(screen.getByText('Cert: 11/08/2027')).toBeInTheDocument();
    expect(screen.queryByText('Cert: 2027-08-11')).not.toBeInTheDocument();
  });
});

describe('todayLocalIso', () => {
  it('usa a data do calendário LOCAL, não a de UTC', () => {
    // 29/08/2026 às 22:30 no fuso local. Em BRT (UTC-3) isso já é 30/08 em UTC,
    // e era exatamente aí que `toISOString().slice(0,10)` marcava como vencido
    // um certificado que vence HOJE.
    const lateNight = new Date(2026, 7, 29, 22, 30, 0);
    expect(todayLocalIso(lateNight)).toBe('2026-08-29');

    // Contrato geral, independente do fuso da máquina de teste.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(todayLocalIso(now)).toBe(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );
  });

  it('em fuso negativo (BRT) difere da data UTC no fim da noite', () => {
    const lateNight = new Date(2026, 7, 29, 22, 30, 0);
    // Só é comparável quando a máquina roda atrás de UTC; em UTC as duas datas
    // coincidem legitimamente.
    if (lateNight.getTimezoneOffset() > 0) {
      expect(todayLocalIso(lateNight)).not.toBe(lateNight.toISOString().slice(0, 10));
    }
  });
});
