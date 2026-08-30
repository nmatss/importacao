import { z } from 'zod';

/**
 * Parametro de rota que carrega um ID numerico.
 *
 * Sem isto, `GET /api/documents/abc` faz `Number('abc')` = NaN chegar ao driver,
 * que serializa para o literal `"NaN"` e devolve
 * `invalid input syntax for type integer: "NaN"`. A redacao de `sendError` impede
 * o vazamento da mensagem do banco, mas o cliente ainda recebe um erro de
 * infraestrutura no lugar de "id invalido" — e a rota gasta uma ida ao banco
 * para descobrir algo que o formato do parametro ja dizia.
 *
 * A convencao de nome e a mesma do repositorio inteiro: `id` e `<coisa>Id` sao
 * numericos; `processCode` e `key` nao sao. `params-de-rota.test.ts` varre os
 * arquivos de rota e falha quando um parametro numerico nasce sem esta guarda.
 */
export const NOME_DE_PARAMETRO_NUMERICO = /^(id|[a-z][A-Za-z]*Id)$/;

/**
 * Schema para os parametros NUMERICOS de uma rota.
 *
 * `passthrough` nao e detalhe: `validate` faz `req.params = result.data`, e o
 * `strip` padrao do Zod APAGARIA os parametros nao declarados. Numa rota como
 * `/:id/custom-stages/:stageId`, declarar so um deles removeria o outro de
 * `req.params` — trocando um erro de validacao por um bug silencioso, que e o
 * oposto do que esta guarda existe para fazer.
 */
export function paramsNumericos(...nomes: [string, ...string[]]) {
  const forma = Object.fromEntries(
    nomes.map((nome) => {
      // A mensagem precisa estar nos TRES niveis. Escrita so no `.positive()`,
      // `abc` falhava antes, na checagem de tipo, e o operador recebia o texto
      // padrao do Zod em ingles — `Expected number, received nan`. E o mesmo
      // defeito ja corrigido nesta base: entrada invalida respondendo com
      // mensagem interna em ingles.
      const mensagem = `${nome} deve ser um ID numerico positivo`;
      return [
        nome,
        z.coerce
          .number({ invalid_type_error: mensagem, required_error: mensagem })
          .int(mensagem)
          .positive(mensagem),
      ];
    }),
  );
  return z.object(forma).passthrough();
}
