import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guarda ESTATICA: so o caminho unico de entrega fala com o Google Chat.
 *
 * O saneamento de 2026-08-29 concentrou a entrega em `delivery.service.ts`
 * (tentativa registrada, deduplicacao, teto, backoff e reentrega). Dois envios
 * ficaram de fora e nenhum teste de comportamento pegava, porque o defeito e a
 * EXISTENCIA de um import:
 *
 * - `modules/validation/service.ts` chamava `sendToGoogleChat` direto depois de
 *   ja ter criado o alerta persistido: cada validacao final com falha rendia
 *   DUAS mensagens no espaco, uma por reprocessamento (11/09: 6 envios diretos
 *   contra 2 alertas persistidos).
 * - `shared/events/handlers.ts` tinha um terceiro envio em codigo morto —
 *   ninguem emite 'validation.completed' —, pronto para ressuscitar a
 *   duplicacao no dia em que alguem emitisse.
 *
 * Esta guarda falha em ambos os casos e passa depois da correcao.
 */
const RAIZ_API = path.resolve(process.cwd(), 'src');

/** O modulo que define o envio e o unico que pode importa-lo. */
const PODEM_IMPORTAR = new Set([
  path.join('modules', 'alerts', 'delivery.service.ts'),
  path.join('modules', 'alerts', 'google-chat.service.ts'),
]);

function arquivosDeFonte(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === '__tests__' ? [] : arquivosDeFonte(completo);
    }
    return entrada.name.endsWith('.ts') ? [completo] : [];
  });
}

/** Comentario que MENCIONA o envio nao envia nada. */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('o Google Chat tem um caminho de entrega so', () => {
  const arquivos = arquivosDeFonte(RAIZ_API);

  it('a varredura enxerga o codigo da API', () => {
    // Contraprova: uma varredura vazia passaria por vacuidade.
    expect(arquivos.length).toBeGreaterThan(100);
    expect(
      arquivos.some((arquivo) => arquivo.endsWith(path.join('alerts', 'delivery.service.ts'))),
    ).toBe(true);
  });

  it('nenhum modulo alem da entrega importa sendToGoogleChat', () => {
    const infratores = arquivos
      .filter((arquivo) => {
        const relativo = path.relative(RAIZ_API, arquivo);
        if (PODEM_IMPORTAR.has(relativo)) return false;
        return /sendToGoogleChat/.test(semComentarios(fs.readFileSync(arquivo, 'utf8')));
      })
      .map((arquivo) => path.relative(RAIZ_API, arquivo))
      .sort();

    expect(infratores).toEqual([]);
  });

  it('a lista de excecoes nao guarda arquivo que sumiu', () => {
    for (const permitido of PODEM_IMPORTAR) {
      expect(fs.existsSync(path.join(RAIZ_API, permitido)), `${permitido} nao existe mais`).toBe(
        true,
      );
    }
  });
});
