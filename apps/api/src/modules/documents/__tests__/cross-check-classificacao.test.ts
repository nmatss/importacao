import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CHECK_LABELS,
  CROSS_CHECK_TARGET_ROWS,
  HIDDEN_CROSS_CHECKS,
  STANDALONE_CROSS_CHECKS,
} from '../comparison-core.js';

/**
 * GUARDA ESTATICA — "declaracao ausente".
 *
 * O comparativo mostrava a chave tecnica crua `invoice-pl-date-tolerance`
 * porque o check existia no servidor e nao estava declarado em lugar nenhum da
 * leitura. Este teste le o CODIGO-FONTE dos checks e falha quando um check novo
 * nao foi classificado (linha agregada, oculto ou linha propria) ou ficou sem
 * rotulo em portugues. Sem isso, o defeito volta silenciosamente no proximo
 * check adicionado.
 */
const checksDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../validation/checks',
);

function checkNamesFromSource(): string[] {
  const indexSource = readFileSync(path.join(checksDir, 'index.ts'), 'utf8');
  const allChecksBlock = /export const allChecks: CheckFn\[\] = \[([\s\S]*?)\]/.exec(indexSource);
  expect(allChecksBlock, 'nao encontrei o array allChecks em checks/index.ts').not.toBeNull();

  const importedNames = allChecksBlock![1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const files = readdirSync(checksDir).filter(
    (file) => file.endsWith('.ts') && file !== 'index.ts',
  );

  const names: string[] = [];
  for (const identifier of importedNames) {
    const importLine = new RegExp(`import ${identifier} from '\\./([\\w-]+)\\.js'`).exec(
      indexSource,
    );
    expect(importLine, `import de ${identifier} nao encontrado`).not.toBeNull();
    const file = `${importLine![1]}.ts`;
    expect(files, `arquivo ${file} nao existe`).toContain(file);
    const source = readFileSync(path.join(checksDir, file), 'utf8');
    const checkName = /const checkName = '([^']+)'/.exec(source)?.[1] ?? importLine![1];
    names.push(checkName);
  }
  return names;
}

describe('classificacao dos checks no comparativo', () => {
  const checkNames = checkNamesFromSource();

  it('le a lista real de checks do servidor', () => {
    expect(checkNames.length).toBeGreaterThan(20);
    expect(checkNames).toContain('invoice-pl-date-tolerance');
  });

  it('todo check esta classificado: linha agregada, oculto ou linha propria', () => {
    const semClassificacao = checkNames.filter(
      (name) =>
        !(name in CROSS_CHECK_TARGET_ROWS) &&
        !HIDDEN_CROSS_CHECKS.has(name) &&
        !(name in STANDALONE_CROSS_CHECKS),
    );

    expect(semClassificacao).toEqual([]);
  });

  it('todo check tem rotulo em portugues (nunca a chave tecnica na tela)', () => {
    const semRotulo = checkNames.filter((name) => !CHECK_LABELS[name]);
    expect(semRotulo).toEqual([]);
  });

  it('nenhum check esta classificado duas vezes', () => {
    const duplicados = checkNames.filter(
      (name) =>
        [
          name in CROSS_CHECK_TARGET_ROWS,
          HIDDEN_CROSS_CHECKS.has(name),
          name in STANDALONE_CROSS_CHECKS,
        ].filter(Boolean).length > 1,
    );

    expect(duplicados).toEqual([]);
  });
});
