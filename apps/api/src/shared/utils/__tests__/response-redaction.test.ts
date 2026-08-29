import { describe, it, expect } from 'vitest';
import { redactInternalDetail, sendError } from '../response.js';

/**
 * Os tres primeiros casos sao exatamente as saidas capturadas pela sonda de
 * seguranca de 2026-08-29, que provou que a mensagem crua do driver chegava ao
 * cliente autenticado pelos controllers de documentos.
 *
 * Os casos de preservacao valem tanto quanto os de redacao: a alternativa que
 * NAO foi escolhida — devolver texto generico para todo erro que nao seja
 * `AppError` — teria apagado 80 mensagens escritas para o operador ler, porque
 * metade dos lancamentos do repositorio ainda usa `throw new Error` cru.
 */
describe('redactInternalDetail()', () => {
  it('esconde IP e porta internos', () => {
    expect(redactInternalDetail('connect ECONNREFUSED 172.19.0.4:5432')).toBe(
      'connect ECONNREFUSED [endereco interno]',
    );
  });

  it('esconde identificador de esquema do Postgres', () => {
    expect(
      redactInternalDetail('column "comparison_field_overrides.field_key" does not exist'),
    ).toBe('column [interno] does not exist');
  });

  it('esconde tipo e limite de coluna', () => {
    expect(redactInternalDetail('value too long for type character varying(500)')).toBe(
      'valor acima do tamanho permitido',
    );
  });

  it('esconde caminho absoluto do servidor', () => {
    expect(redactInternalDetail('ENOENT: /uploads/2026/nota.pdf')).toBe(
      'ENOENT: [caminho interno]',
    );
    expect(redactInternalDetail('falhou em /home/deploy/importacao/app.js')).toBe(
      'falhou em [caminho interno]',
    );
  });

  it('PRESERVA a mensagem escrita para o operador', () => {
    const humanas = [
      'Processo não encontrado',
      'Documento já existe para este processo (409)',
      'A justificativa precisa ter pelo menos 3 caracteres',
      'MAIL_DRY_RUN está ativo: nada foi enviado.',
      'Invoice PK2052602TJ sem item correspondente no Packing List',
    ];
    for (const msg of humanas) expect(redactInternalDetail(msg)).toBe(msg);
  });

  it('PRESERVA rota de API — nao confunde com caminho de arquivo', () => {
    expect(redactInternalDetail('rota /api/processes/7 indisponível')).toBe(
      'rota /api/processes/7 indisponível',
    );
  });

  it('preserva numero que nao e endereco', () => {
    expect(redactInternalDetail('processo 2026 com 4 documentos e 500 itens')).toBe(
      'processo 2026 com 4 documentos e 500 itens',
    );
  });
});

describe('sendError()', () => {
  function res() {
    const r: {
      statusCode: number;
      payload: { success: boolean; error: string } | null;
      status(c: number): typeof r;
      json(b: unknown): typeof r;
    } = {
      statusCode: 0,
      payload: null,
      status(c: number) {
        r.statusCode = c;
        return r;
      },
      json(b: unknown) {
        r.payload = b as { success: boolean; error: string };
        return r;
      },
    };
    return r;
  }

  it('redige no ponto de saida, sem precisar tocar nos 107 catch', () => {
    const r = res();
    sendError(
      r as unknown as Parameters<typeof sendError>[0],
      'connect ECONNREFUSED 172.19.0.4:5432',
      500,
    );
    expect(r.statusCode).toBe(500);
    expect(r.payload?.error).not.toContain('172.19.0.4');
    expect(r.payload?.success).toBe(false);
  });
});
