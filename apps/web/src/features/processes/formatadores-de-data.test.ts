import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guarda estatica: a tela do processo nao pode voltar a ter formatador de data
 * proprio.
 *
 * O "ETD 06/08" com a invoice dizendo 07/08 (reuniao 11/09) nao veio de um bug
 * de logica: veio de CADA componente escrever o seu
 * `new Date(x).toLocaleDateString('pt-BR')`. Corrigir um por um deixa o
 * proximo de fora — e a proxima tela nova tambem. Quem formata data na web e
 * `shared/lib/utils.ts`, que trata data de calendario sem fuso e instante no
 * fuso da operacao.
 *
 * A lista de pendentes abaixo encolhe; ela nao cresce.
 */
const PENDENTES = new Set([
  // Datas de upload de documento (instante). Dono: ui-processo/extracao.
  'components/DraftBLTab.tsx',
  'components/DocumentsTab.tsx',
  // Data do lock do processo. Dono: ui-processo.
  'ProcessEditPage.tsx',
]);

/** Mesma estrategia do guard de tokens de cor: o cwd do vitest varia. */
function raizDaFeature(): string {
  const candidatos = [
    path.resolve(process.cwd(), 'src/features/processes'),
    path.resolve(process.cwd(), 'apps/web/src/features/processes'),
    path.resolve(process.cwd(), '../../apps/web/src/features/processes'),
  ];
  const encontrado = candidatos.find((dir) =>
    existsSync(path.join(dir, 'components', 'LogisticStatusBar.tsx')),
  );
  if (!encontrado) throw new Error(`Nao encontrei features/processes a partir de ${process.cwd()}`);
  return encontrado;
}

const RAIZ = raizDaFeature();

function arquivosDaTela(dir: string, prefixo = ''): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const completo = path.join(dir, nome);
    const relativo = prefixo ? `${prefixo}/${nome}` : nome;
    if (statSync(completo).isDirectory()) return arquivosDaTela(completo, relativo);
    if (!/\.tsx?$/.test(nome) || /\.test\.tsx?$/.test(nome)) return [];
    return [relativo];
  });
}

/** Comentario nao e codigo: o proprio aviso cita a chamada proibida. */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('formatacao de data na tela do processo', () => {
  const arquivos = arquivosDaTela(RAIZ);

  it('encontra os arquivos da feature (o teste nao pode passar por engano)', () => {
    expect(arquivos.length).toBeGreaterThan(10);
    expect(arquivos).toContain('components/LogisticStatusBar.tsx');
  });

  it.each(arquivos.filter((arquivo) => !PENDENTES.has(arquivo)))(
    '%s nao formata data por conta propria',
    (arquivo) => {
      const codigo = semComentarios(readFileSync(path.join(RAIZ, arquivo), 'utf-8'));
      expect(codigo).not.toMatch(/toLocaleDateString|toLocaleTimeString/);
    },
  );

  it('os pendentes ainda existem (remover da lista quando forem corrigidos)', () => {
    for (const pendente of PENDENTES) {
      expect(arquivos).toContain(pendente);
    }
  });
});
