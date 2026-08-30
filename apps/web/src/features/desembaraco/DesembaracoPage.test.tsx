import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/shared/hooks/useApi', () => ({ useAllPagesQuery: vi.fn() }));

import { useAllPagesQuery } from '@/shared/hooks/useApi';
import { DesembaracoPage } from './DesembaracoPage';

/**
 * O defeito que estes casos congelam: ate 2026-08-29 a tela lia EXCLUSIVAMENTE
 * `aiExtractedData`, cujo unico produtor e um script manual de importacao,
 * enquanto o formulario de edicao de processo grava colunas TIPADAS. Um
 * analista que preenchia o canal aduaneiro no formulario nunca via o resultado
 * aqui — e o processo nem sequer aparecia na lista, porque a propria inclusao
 * dependia do blob.
 */
type Processo = Record<string, unknown>;

function montar(processos: Processo[]) {
  vi.mocked(useAllPagesQuery).mockReturnValue({
    data: { data: processos },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    truncated: false,
  } as unknown as ReturnType<typeof useAllPagesQuery>);

  render(
    <MemoryRouter>
      <DesembaracoPage />
    </MemoryRouter>,
  );
}

const base = {
  id: 1,
  processCode: 'PK2052602TJ',
  status: 'validating',
  aiExtractedData: null,
  customsChannel: null,
  customsClearanceAt: null,
  diNumber: null,
  registeredAt: null,
  cdArrivalAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe('DesembaracoPage — fonte do dado aduaneiro', () => {
  it('mostra o processo cujo canal veio SO do formulario', () => {
    montar([{ ...base, customsChannel: 'Verde' }]);

    expect(screen.getByText('PK2052602TJ')).toBeInTheDocument();
    expect(screen.getByText('Verde')).toBeInTheDocument();
  });

  it('continua mostrando o que veio SO da planilha importada', () => {
    montar([{ ...base, aiExtractedData: { canal: 'Amarelo', numeroDI: '24/123' } }]);

    expect(screen.getByText('Amarelo')).toBeInTheDocument();
    expect(screen.getByText('24/123')).toBeInTheDocument();
  });

  it('a coluna tipada vence o blob quando os dois existem', () => {
    montar([
      {
        ...base,
        customsChannel: 'Vermelho',
        aiExtractedData: { canal: 'Verde' },
      },
    ]);

    expect(screen.getByText('Vermelho')).toBeInTheDocument();
    expect(screen.queryByText('Verde')).not.toBeInTheDocument();
  });

  it('divergencia entre as duas fontes fica VISIVEL, nao silenciosa', () => {
    montar([
      {
        ...base,
        customsChannel: 'Vermelho',
        aiExtractedData: { canal: 'Verde' },
      },
    ]);

    expect(screen.getByTitle(/Planilha importada registra "Verde"/)).toBeInTheDocument();
  });

  it('sem divergencia nao marca nada', () => {
    montar([{ ...base, customsChannel: 'Verde', aiExtractedData: { canal: 'Verde' } }]);

    expect(screen.queryByTitle(/Planilha importada registra/)).not.toBeInTheDocument();
  });

  it('processo sem nenhum dado aduaneiro continua fora da tela', () => {
    montar([{ ...base }]);

    expect(screen.queryByText('PK2052602TJ')).not.toBeInTheDocument();
  });
});
