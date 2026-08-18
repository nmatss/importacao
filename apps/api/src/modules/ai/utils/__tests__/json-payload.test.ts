import { describe, it, expect } from 'vitest';
import {
  stripCodeFences,
  extractJsonPayload,
  looksTruncatedJson,
  parseModelJson,
} from '../json-payload.js';

/**
 * Em 17/08/2026, 6 dos 17 documentos em falha terminal de producao tinham o
 * motivo "invalid JSON" — todos invoice/proforma reais e legiveis. O parse era
 * um `JSON.parse` cru, entao qualquer texto em volta do payload derrubava a
 * extracao inteira e a tela ficava com "-" em todo campo.
 */
describe('recuperacao do JSON do modelo', () => {
  describe('stripCodeFences()', () => {
    it('remove cerca markdown com marcador de linguagem', () => {
      expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('remove cerca sem marcador', () => {
      expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it('nao mexe em resposta sem cerca', () => {
      expect(stripCodeFences('{"a":1}')).toBe('{"a":1}');
    });
  });

  describe('extractJsonPayload()', () => {
    it('recorta objeto cercado por texto', () => {
      expect(extractJsonPayload('Segue o resultado:\n{"total":10}\nEspero ter ajudado.')).toBe(
        '{"total":10}',
      );
    });

    it('recorta array', () => {
      expect(extractJsonPayload('resposta: [1,2,3] fim')).toBe('[1,2,3]');
    });

    it('nao se perde com chave dentro de string', () => {
      // Se a contagem de profundidade ignorar string literal, o recorte fecha
      // cedo e produz um JSON VALIDO porem truncado — pior que falhar, porque
      // entraria como dado bom.
      const raw = '{"descricao":"caixa {grande}","total":10}';
      expect(extractJsonPayload(`texto ${raw} texto`)).toBe(raw);
    });

    it('nao se perde com aspas escapadas', () => {
      const raw = '{"obs":"diz \\"ok\\" aqui","n":1}';
      expect(extractJsonPayload(raw)).toBe(raw);
    });

    it('devolve null quando a estrutura nunca fecha', () => {
      expect(extractJsonPayload('{"items":[{"a":1},{"b":')).toBeNull();
    });

    it('devolve null quando nao ha JSON', () => {
      expect(extractJsonPayload('nao consegui ler o documento')).toBeNull();
    });
  });

  describe('looksTruncatedJson()', () => {
    it('reconhece resposta cortada no meio', () => {
      expect(looksTruncatedJson('{"items":[{"desc":"abc"')).toBe(true);
    });

    it('nao acusa resposta completa', () => {
      expect(looksTruncatedJson('{"items":[]}')).toBe(false);
    });

    it('nao acusa texto sem nenhum JSON', () => {
      expect(looksTruncatedJson('desculpe, nao consegui')).toBe(false);
    });
  });

  describe('parseModelJson()', () => {
    it('parseia resposta limpa sem recorte', () => {
      expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, how: 'clean' });
    });

    it('recupera JSON dentro de cerca markdown', () => {
      const out = parseModelJson('```json\n{"invoiceNumber":"INV-1"}\n```');
      expect(out.ok).toBe(true);
      expect(out.how).toBe('salvaged');
      expect(out.value).toEqual({ invoiceNumber: 'INV-1' });
    });

    it('recupera JSON depois de preambulo do modelo', () => {
      const out = parseModelJson('Claro! Aqui esta:\n{"total":42}');
      expect(out.ok).toBe(true);
      expect(out.value).toEqual({ total: 42 });
    });

    it('classifica resposta truncada como truncated, nao como no_json', () => {
      // A acao do operador muda: truncado pede teto de tokens maior.
      const out = parseModelJson('{"items":[{"desc":"parafuso","qty":10},{"desc":"por');
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('truncated');
    });

    it('classifica resposta sem JSON como no_json', () => {
      const out = parseModelJson('Nao foi possivel extrair dados deste documento.');
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('no_json');
    });

    it('nao aceita payload balanceado porem invalido', () => {
      const out = parseModelJson('{"a": undefined}');
      expect(out.ok).toBe(false);
    });
  });
});

describe('AIResponseContractError', () => {
  it('carrega o motivo para quem decide escalonar', async () => {
    const { AIResponseContractError } = await import('../json-payload.js');
    const err = new AIResponseContractError('x', 'truncated');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AIResponseContractError');
    expect(err.reason).toBe('truncated');
  });

  it('e distinguivel de um Error comum, que NAO deve escalonar', async () => {
    const { AIResponseContractError } = await import('../json-payload.js');

    // Orcamento estourado e timeout nao melhoram num modelo mais lento e caro:
    // o escalonamento tem de ser exclusivo de violacao de contrato.
    expect(new Error('budget') instanceof AIResponseContractError).toBe(false);
  });
});
