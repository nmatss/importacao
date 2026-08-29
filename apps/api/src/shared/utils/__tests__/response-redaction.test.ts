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

  /**
   * Achado da auto-revisao: com a alternancia na ordem errada, "/apps/web/src"
   * casava apenas "/app" e a substituicao devolvia "[caminho interno]s/web/src",
   * vazando o resto do caminho colado no marcador.
   */
  it('nao parte o caminho ao meio quando a raiz e prefixo de outra', () => {
    expect(redactInternalDetail('erro em /apps/web/src/main.tsx')).toBe(
      'erro em [caminho interno]',
    );
    expect(redactInternalDetail('stack: /app/dist/server.js:12')).toBe(
      'stack: [caminho interno]:12',
    );
  });

  /**
   * Estas tres saidas foram MEDIDAS pelo revisor de seguranca passando pelos
   * controllers de verdade, DEPOIS da primeira versao desta redacao — ou seja,
   * sao lacunas que a primeira correcao deixou abertas.
   *
   * A primeira e a mais constrangedora: o incidente citado no comentario da
   * propria funcao (`ECONNREFUSED 172.19.0.4:5432`) continuava vazando, porque
   * o `DATABASE_URL` conecta pelo NOME do servico do compose. Quando o banco
   * cai de verdade, a mensagem e `getaddrinfo ENOTFOUND postgres`, e o padrao
   * de IPv4 nao ve nome nenhum.
   */
  it('esconde host interno por NOME, nao so por endereco', () => {
    expect(redactInternalDetail('getaddrinfo ENOTFOUND postgres')).toBe(
      'getaddrinfo ENOTFOUND [host interno]',
    );
    expect(
      redactInternalDetail('IA_LOCAL request failed: connect ECONNREFUSED ia-local:11434'),
    ).toBe('IA_LOCAL request failed: connect ECONNREFUSED [host interno]');
    expect(redactInternalDetail('connect ETIMEDOUT cert-api:8000')).toBe(
      'connect ETIMEDOUT [host interno]',
    );
  });

  it('esconde identificador de esquema mesmo com texto entre a palavra e as aspas', () => {
    // Sai quando um `Number(req.params.id)` vira NaN e chega ao driver.
    expect(redactInternalDetail('invalid input syntax for type integer: "NaN"')).toBe(
      'invalid input syntax for type [interno]',
    );
    expect(redactInternalDetail('role "importacao_app" does not exist')).toBe(
      'role [interno] does not exist',
    );
  });

  it('PRESERVA a mensagem escrita para o operador', () => {
    const humanas = [
      'Processo não encontrado',
      'Documento já existe para este processo (409)',
      'A justificativa precisa ter pelo menos 3 caracteres',
      'MAIL_DRY_RUN está ativo: nada foi enviado.',
      // Nenhuma mensagem de operador comeca por errno, entao a regra nova nao
      // as alcanca — nem quando falam de rede.
      'Falha de conexão com o SYDLE. Tente novamente em alguns minutos.',
      'O tipo de documento "invoice" já existe neste processo',
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
