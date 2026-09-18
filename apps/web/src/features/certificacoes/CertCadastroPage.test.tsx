import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    fetchCertificateDetail: vi.fn(),
    linkCertificateItems: vi.fn(),
    removeCertificateItem: vi.fn(),
    updateCertificateItemRestriction: vi.fn(),
  };
});

import {
  createCertificate,
  fetchCertProductDetail,
  fetchCertificateDetail,
  fetchCertificates,
  linkCertificateItems,
  lookupCertificateLinx,
  removeCertificateItem,
  updateCertificateItemRestriction,
  type CertCertificate,
} from '@/shared/lib/cert-api-client';
import CertCadastroPage, { parsePastedSkus, todayLocalIso } from './CertCadastroPage';

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

  it('consults Linx and preserves typed validity without permitting licensing edits', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.selectOptions(screen.getByLabelText(/Marca \/ Loja/i), 'puket');
    await user.type(screen.getByLabelText(/SKU do produto/i), '100400496');
    await user.type(screen.getByLabelText(/Validade do Certificado/i), '2028-01-20');
    await user.click(screen.getByRole('button', { name: /Buscar no Linx/i }));

    await waitFor(() => expect(mockedLookup).toHaveBeenCalledWith('puket', '100400496'));
    expect(screen.getByLabelText(/Validade do Certificado/i)).toHaveValue('2028-01-20');
    expect(screen.getByLabelText(/Vencimento do Licenciamento/i)).toHaveValue('');
    expect(screen.getByLabelText(/Nº do Certificado/i)).toHaveValue('006083/2024');
    expect(screen.getByText(/prop 00224/i)).toBeInTheDocument();
    expect(screen.getByText(/prop 00225/i)).toBeInTheDocument();
  });

  it('não usa o fim de venda legado do Linx para preencher a validade', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);
    await user.type(screen.getByLabelText(/SKU do produto/i), '100400496');
    await user.click(screen.getByRole('button', { name: /Buscar no Linx/i }));
    await screen.findByText(/dados atuais consultados/);
    expect(screen.getByLabelText(/Validade do Certificado/i)).toHaveValue('');
    expect(screen.getByLabelText(/Fim de venda \(trava\)/i)).toHaveValue('');
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

const mockedCreate = vi.mocked(createCertificate);
const mockedDetail = vi.mocked(fetchCertificateDetail);
const mockedLink = vi.mocked(linkCertificateItems);
const mockedRemove = vi.mocked(removeCertificateItem);

function certificate(overrides: Partial<CertCertificate> = {}): CertCertificate {
  return {
    id: 'c1',
    sku: 'PI5555Y',
    brand: 'imaginarium',
    numero_certificado: '10584/2024-AE-1',
    fim_venda: null,
    situacao: 'ATIVO',
    linx_status: 'disabled',
    items_count: 2,
    ...overrides,
  };
}

describe('parsePastedSkus', () => {
  it('le uma lista colada preservando a ordem e sem repetidos', () => {
    expect(parsePastedSkus('A\nB\n\nA\nC')).toEqual(['A', 'B', 'C']);
    expect(parsePastedSkus('A, B; C')).toEqual(['A', 'B', 'C']);
    expect(parsePastedSkus('   ')).toEqual([]);
  });
});

describe('CertCadastroPage — fim de venda e itens (D11)', () => {
  beforeEach(() => {
    mockedFetchCertificates.mockReset();
    mockedFetchProduct.mockReset();
    mockedLookup.mockReset();
    mockedCreate.mockReset();
    mockedDetail.mockReset();
    mockedLink.mockReset();
    mockedRemove.mockReset();
    mockedFetchCertificates.mockResolvedValue({
      items: [certificate()],
      total: 1,
      page: 1,
      per_page: 10,
      total_pages: 1,
    });
    mockedDetail.mockResolvedValue(
      certificate({
        items: [
          {
            id: 'i1',
            certificate_id: 'c1',
            sku: 'PI5555Y',
            brand: 'imaginarium',
            linx_status: 'disabled',
          },
        ],
      }),
    );
  });

  it('envia fim_venda no cadastro e explica que a validade fica no portal', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(certificate());
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKU do produto *'), 'PI5558Y');
    await user.type(screen.getByLabelText('Validade do Certificado'), '2028-07-27');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    await user.type(screen.getByLabelText('Fim de venda (trava)'), '2026-10-29');
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: 'PI5558Y',
          validade_certificado: '2028-07-27',
          fim_venda: '2026-10-29',
          situacao: 'ENCERRADO',
        }),
      ),
    );
    expect(screen.getByText(/Fica só no portal/)).toBeInTheDocument();
  });

  it('licenciamento é somente leitura e não é enviado ao cadastrar certificado ativo', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(certificate());
    render(<CertCadastroPage />);
    expect(screen.getByLabelText('Vencimento do Licenciamento')).toHaveAttribute('readonly');
    await user.type(screen.getByLabelText('SKU do produto *'), '050404509');
    await user.type(screen.getByLabelText('Validade do Certificado'), '2028-07-27');
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    expect(mockedCreate.mock.calls[0][0]).not.toHaveProperty('vencimento_licenciamento');
    expect(mockedCreate.mock.calls[0][0].fim_venda).toBeUndefined();
  });

  it('aceita apenas o fim de venda como unica data informada', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(certificate());
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKU do produto *'), 'PI5558Y');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    await user.type(screen.getByLabelText('Fim de venda (trava)'), '2026-10-29');
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
  });

  it('manda a lista colada de SKUs no cadastro', async () => {
    const user = userEvent.setup();
    mockedCreate.mockResolvedValue(certificate());
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKUs adicionais (um por linha)'), 'A\nB\nA\nC');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    await user.type(screen.getByLabelText('Fim de venda (trava)'), '2026-10-29');
    expect(screen.getByText(/3 SKU\(s\) serão vinculados/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ skus: 'A\nB\nC' })),
    );
  });

  it('pre-visualiza o vinculo antes de gravar no Linx', async () => {
    const user = userEvent.setup();
    mockedLink.mockResolvedValue({
      dry_run: true,
      added: ['A', 'B'],
      already_linked: ['PI5555Y'],
      linked_to_other_active_cert: [{ sku: 'PI6552Y', numero_certificado: '8325/2022-BRI-1' }],
      not_found_in_linx: ['FANTASMA'],
      invalid: [],
    });
    render(<CertCadastroPage />);

    await user.click(await screen.findByRole('button', { name: /Itens \(2\)/ }));
    await waitFor(() => expect(mockedDetail).toHaveBeenCalledWith('c1'));

    const textarea = screen.getByLabelText('Vincular SKUs (um por linha)');
    await user.type(textarea, 'A\nB');
    // O botao de confirmar so libera depois da previa.
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Pré-visualizar \(2\)/ }));

    await waitFor(() => expect(mockedLink).toHaveBeenCalledWith('c1', ['A', 'B'], true));
    expect(await screen.findByText(/8325\/2022-BRI-1/)).toBeInTheDocument();
    expect(screen.getByText(/FANTASMA/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vincular' })).toBeEnabled();
  });

  it('confirma o vinculo com dry_run=false', async () => {
    const user = userEvent.setup();
    mockedLink.mockResolvedValueOnce({
      dry_run: true,
      added: ['A'],
      already_linked: [],
      linked_to_other_active_cert: [],
      not_found_in_linx: [],
      invalid: [],
    });
    mockedLink.mockResolvedValueOnce({
      dry_run: false,
      added: ['A'],
      already_linked: [],
      linked_to_other_active_cert: [],
      not_found_in_linx: [],
      invalid: [],
      items: [
        { id: 'i2', certificate_id: 'c1', sku: 'A', brand: 'imaginarium', linx_status: 'applied' },
      ],
    });
    render(<CertCadastroPage />);

    await user.click(await screen.findByRole('button', { name: /Itens \(2\)/ }));
    await user.type(screen.getByLabelText('Vincular SKUs (um por linha)'), 'A');
    await user.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Vincular' }));

    await waitFor(() => expect(mockedLink).toHaveBeenLastCalledWith('c1', ['A'], false));
    // Confirmado uma vez, o botão trava: clicar de novo reenviaria uma lista
    // vazia (o textarea foi limpo) e gravaria no Linx por engano.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular' })).toBeDisabled());
    expect(mockedLink).toHaveBeenCalledTimes(2);
  });

  it('encerra apenas um item e restaura herança com motivo sem apagar o vínculo', async () => {
    const user = userEvent.setup();
    const item = {
      id: 'i1',
      certificate_id: 'c1',
      sku: 'PI5555Y',
      brand: 'imaginarium',
      linx_status: 'pending' as const,
      situacao: 'ENCERRADO' as const,
      situacao_efetiva: 'ENCERRADO' as const,
      fim_venda: '2026-10-29',
      fim_venda_efetivo: '2026-10-29',
      restricao_origem: 'item' as const,
    };
    vi.mocked(updateCertificateItemRestriction)
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce({
        ...item,
        situacao: null,
        situacao_efetiva: 'ATIVO',
        fim_venda: null,
        fim_venda_efetivo: null,
        restricao_origem: 'certificado',
      });
    mockedDetail.mockResolvedValueOnce(
      certificate({
        items: [
          {
            ...item,
            situacao: null,
            situacao_efetiva: 'ATIVO',
            fim_venda: null,
            fim_venda_efetivo: null,
            restricao_origem: 'certificado',
          },
          {
            ...item,
            id: 'i2',
            sku: 'OUTRO-SKU',
            situacao: null,
            situacao_efetiva: 'ATIVO',
            restricao_origem: 'certificado',
          },
        ],
      }),
    );
    render(<CertCadastroPage />);
    await user.click(await screen.findByRole('button', { name: /Itens \(2\)/ }));
    await user.click(await screen.findByRole('button', { name: 'Encerrar item PI5555Y' }));
    expect(screen.getByRole('button', { name: 'Salvar restrição do item' })).toBeDisabled();
    await user.type(screen.getByLabelText('Fim de venda por certificação do item'), '2026-10-29');
    await user.type(
      screen.getByLabelText('Motivo da alteração do item'),
      'Prazo aprovado pela certificação',
    );
    await user.click(screen.getByRole('button', { name: 'Salvar restrição do item' }));
    await waitFor(() =>
      expect(updateCertificateItemRestriction).toHaveBeenCalledWith('c1', 'PI5555Y', {
        situacao: 'ENCERRADO',
        fim_venda: '2026-10-29',
        motivo: 'Prazo aprovado pela certificação',
      }),
    );
    expect(mockedRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Encerrar item OUTRO-SKU' })).toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', { name: 'Herdar certificado para PI5555Y' }),
    );
    await user.type(
      screen.getByLabelText('Motivo da alteração do item'),
      'Retorno aprovado ao certificado vigente',
    );
    await user.click(screen.getByRole('button', { name: 'Salvar restrição do item' }));
    await waitFor(() =>
      expect(updateCertificateItemRestriction).toHaveBeenLastCalledWith('c1', 'PI5555Y', {
        situacao: null,
        fim_venda: null,
        motivo: 'Retorno aprovado ao certificado vigente',
      }),
    );
    expect(mockedRemove).not.toHaveBeenCalled();
  });

  it('remove um item pelo botao da lixeira', async () => {
    const user = userEvent.setup();
    mockedRemove.mockResolvedValue({ ok: true, items: [] });
    render(<CertCadastroPage />);

    await user.click(await screen.findByRole('button', { name: /Itens \(2\)/ }));
    await user.click(await screen.findByRole('button', { name: 'Remover PI5555Y do certificado' }));

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith('c1', 'PI5555Y'));
    expect(
      await screen.findByText(/Nenhum produto vinculado a este certificado/),
    ).toBeInTheDocument();
  });

  it('avisa que a remocao nao mexe na trava ja gravada no Linx', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.click(await screen.findByRole('button', { name: /Itens \(2\)/ }));

    expect(await screen.findByText(/a data já gravada no Linx permanece/)).toBeInTheDocument();
  });
});

// ── C1: a tela nunca mandava `situacao`; o back assumia ATIVO e devolvia 400 para
// todo cadastro com fim de venda. Os testes antigos não pegavam porque o front
// mocka `createCertificate` e o back sempre mandava ENCERRADO. O contrato abaixo
// é um arquivo lido pelos DOIS lados (ver test_certificates_routes.py).
function loadCreateContract(): {
  encerrado: Record<string, string>;
  ativo: Record<string, string>;
} {
  const relative = 'apps/cert-api/tests/fixtures/certificate_create_contract.json';
  const candidates = [
    resolve(process.cwd(), '../cert-api/tests/fixtures/certificate_create_contract.json'),
    resolve(process.cwd(), relative),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Nao encontrei ${relative} a partir de ${process.cwd()}`);
  return JSON.parse(readFileSync(found, 'utf-8'));
}

/** O que a tela mandou de fato: sem chaves `undefined` e sem o PDF ausente. */
function sentPayload(): Record<string, unknown> {
  const input = mockedCreate.mock.calls[0][0] as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

describe('CertCadastroPage — situação do certificado (contrato com o cert-api)', () => {
  const contract = loadCreateContract();

  beforeEach(() => {
    mockedFetchCertificates.mockReset();
    mockedCreate.mockReset();
    mockedFetchCertificates.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      per_page: 10,
      total_pages: 1,
    });
    mockedCreate.mockResolvedValue(certificate());
  });

  it('certificado ativo: fim de venda desabilitado e payload igual ao contrato', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    expect(screen.getByLabelText('Situação do certificado *')).toHaveValue('ATIVO');
    expect(screen.getByLabelText('Fim de venda (trava)')).toBeDisabled();

    await user.type(screen.getByLabelText('SKU do produto *'), contract.ativo.sku);
    await user.type(
      screen.getByLabelText('Validade do Certificado'),
      contract.ativo.validade_certificado,
    );
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    expect(sentPayload()).toEqual(contract.ativo);
  });

  it('certificado encerrado: habilita o fim de venda e o payload é o do contrato', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKU do produto *'), contract.encerrado.sku);
    await user.type(
      screen.getByLabelText('Validade do Certificado'),
      contract.encerrado.validade_certificado,
    );
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    const fimVenda = screen.getByLabelText('Fim de venda (trava)');
    expect(fimVenda).toBeEnabled();
    expect(fimVenda).toHaveAttribute('aria-required', 'true');
    await user.type(fimVenda, contract.encerrado.fim_venda);
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    expect(sentPayload()).toEqual(contract.encerrado);
  });

  it('voltar para Ativo limpa o fim de venda e ele não é enviado', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKU do produto *'), 'PI5555Y');
    await user.type(screen.getByLabelText('Validade do Certificado'), '2027-03-22');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    await user.type(screen.getByLabelText('Fim de venda (trava)'), '2026-10-29');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ATIVO');

    expect(screen.getByLabelText('Fim de venda (trava)')).toHaveValue('');
    expect(screen.getByLabelText('Fim de venda (trava)')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));
    await waitFor(() => expect(mockedCreate).toHaveBeenCalledOnce());
    expect(sentPayload()).toEqual(contract.ativo);
  });

  it('encerrado sem fim de venda não é enviado: o erro aparece na tela', async () => {
    const user = userEvent.setup();
    render(<CertCadastroPage />);

    await user.type(screen.getByLabelText('SKU do produto *'), 'PI5558Y');
    await user.type(screen.getByLabelText('Validade do Certificado'), '2028-07-27');
    await user.selectOptions(screen.getByLabelText('Situação do certificado *'), 'ENCERRADO');
    await user.click(screen.getByRole('button', { name: /Cadastrar e gravar no Linx/ }));

    expect(
      await screen.findByText(/Informe o fim de venda do certificado encerrado/),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});

describe('createCertificate (cliente real) — multipart do contrato', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['ativo', 'encerrado'] as const)(
    'monta exatamente os campos do contrato (%s)',
    async (scenario) => {
      const contract = loadCreateContract()[scenario];
      const actual = await vi.importActual<typeof import('@/shared/lib/cert-api-client')>(
        '@/shared/lib/cert-api-client',
      );
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'c1', linx_status: 'disabled' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await actual.createCertificate({ ...contract, pdf: null } as Parameters<
        typeof actual.createCertificate
      >[0]);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/\/api\/certificates$/);
      expect(init.method).toBe('POST');
      const sent = Object.fromEntries((init.body as FormData).entries());
      expect(sent).toEqual(contract);
    },
  );
});
