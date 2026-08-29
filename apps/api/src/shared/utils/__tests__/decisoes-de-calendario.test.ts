import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(process.cwd(), 'src');

/**
 * Guarda contra a decisao de calendario feita no fuso errado.
 *
 * Os containers rodam em UTC — nao ha `TZ` em nenhum compose nem Dockerfile — e
 * os operadores usam o calendario brasileiro. Entre 21:00 e 23:59 no Brasil, o
 * banco e o processo ja viraram o dia. Toda decisao de calendario escrita de
 * forma ingenua erra um dia nessas tres horas, todos os dias.
 *
 * Medido contra um Postgres 16 em UTC em 2026-08-29, com `now()` as 21:30 local:
 *
 *   janela de proximos pagamentos ... o vencido de ontem SOME e entra um dia
 *                                    a mais na outra ponta
 *   "processo atrasado" ............ dispara 27h antes da hora
 *   "dias restantes" da LI .......... "vence amanha" e "vence hoje" viram ambos 0
 *   grafico por mes ................. processo criado as 22h do dia 31 conta no
 *                                    mes seguinte
 *
 * Cada padrao proibido abaixo produziu um desses. A guarda e sobre a AUSENCIA
 * da conversao, que e o motivo de nenhum teste de runtime peg-la.
 */
const PROIBIDOS: Array<{ padrao: RegExp; porque: string; use: string }> = [
  {
    padrao: /\bnow\(\)::date\b/g,
    porque: 'da o dia em UTC',
    use: 'SQL_HOJE_LOCAL',
  },
  {
    padrao: /\bCURRENT_DATE\b/g,
    porque: 'da o dia em UTC',
    use: 'SQL_HOJE_LOCAL',
  },
  {
    padrao: /EXTRACT\(DAY FROM[^`]*?-\s*now\(\)\)/g,
    porque: 'descarta o dia parcial, entao hoje e amanha ficam iguais',
    use: 'subtracao de ::date contra SQL_HOJE_LOCAL',
  },
  {
    padrao: /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/g,
    porque: 'da a data em UTC',
    use: 'localTodayIso()',
  },
];

/** Modulos que decidem calendario para o operador. */
const ESCOPO = ['modules/dashboard', 'modules/sydle', 'modules/follow-up', 'modules/reports'];

function arquivosDeFonte(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return entrada.name === '__tests__' ? [] : arquivosDeFonte(completo);
    }
    return entrada.name.endsWith('.ts') && !entrada.name.endsWith('.test.ts') ? [completo] : [];
  });
}

describe('decisoes de calendario usam o fuso do operador', () => {
  const arquivos = ESCOPO.flatMap((rel) => arquivosDeFonte(path.join(RAIZ, rel)));

  it('o escopo varrido nao esta vazio', () => {
    // Sem isto, renomear um modulo faria a guarda passar varrendo nada.
    expect(arquivos.length).toBeGreaterThan(5);
  });

  it('nenhum padrao ingenuo de data sobreviveu', () => {
    const achados: string[] = [];

    for (const arquivo of arquivos) {
      const conteudo = fs.readFileSync(arquivo, 'utf-8');
      const linhas = conteudo.split('\n');

      for (const { padrao, porque, use } of PROIBIDOS) {
        linhas.forEach((linha, i) => {
          // Comentario explicando o defeito nao e o defeito.
          const semComentario = linha.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          padrao.lastIndex = 0;
          if (padrao.test(semComentario)) {
            achados.push(`${path.relative(RAIZ, arquivo)}:${i + 1} — ${porque}; use ${use}`);
          }
        });
      }
    }

    expect(achados, `Decisoes de calendario em UTC:\n${achados.join('\n')}`).toEqual([]);
  });
});
