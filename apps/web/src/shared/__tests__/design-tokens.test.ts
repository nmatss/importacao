import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Guarda contra tom de cor usado e nao definido.
 *
 * O Tailwind v4 nao gera classe para um tom que nao existe no `@theme` e nao
 * emite erro nenhum: `dark:bg-danger-950/40` simplesmente nao pinta. Foi assim
 * que 67 classes — incluindo as superficies de erro compartilhadas
 * (ErrorBoundary, ErrorState, ConfirmDialog, AppLayout) — ficaram sem fundo no
 * tema escuro sem que lint, typecheck, teste ou build acusassem nada.
 */
const UTILITIES =
  'text|bg|border|from|to|via|ring|divide|outline|fill|stroke|accent|decoration|shadow';

function webSrcDir(): string {
  const candidates = [
    resolve(process.cwd(), 'src'),
    resolve(process.cwd(), 'apps/web/src'),
    resolve(process.cwd(), '../../apps/web/src'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'app', 'index.css')));
  if (!found) throw new Error(`Nao encontrei apps/web/src a partir de ${process.cwd()}`);
  return found;
}

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      collectSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function definedShades(css: string): Map<string, Set<number>> {
  const defined = new Map<string, Set<number>>();
  for (const match of css.matchAll(/--color-([a-z-]+?)-(\d+):/g)) {
    const name = match[1];
    if (!defined.has(name)) defined.set(name, new Set());
    defined.get(name)!.add(Number(match[2]));
  }
  return defined;
}

describe('tokens de cor do design system', () => {
  const srcDir = webSrcDir();
  const css = readFileSync(join(srcDir, 'app', 'index.css'), 'utf-8');
  const defined = definedShades(css);

  it('toda classe de cor usada tem tom definido no @theme', () => {
    expect(defined.size).toBeGreaterThan(0);
    const files = collectSourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(50);

    const pattern = new RegExp(`(?:${UTILITIES})-([a-z]+(?:-[a-z]+)*)-(\\d{2,3})\\b`, 'g');
    const missing: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(pattern)) {
        const [, name, rawShade] = match;
        const shades = defined.get(name);
        // Paletas nativas do Tailwind (slate, emerald, violet...) nao precisam
        // estar declaradas no @theme; so checamos as que o projeto define.
        if (!shades) continue;
        if (!shades.has(Number(rawShade))) {
          missing.push(`${file.slice(srcDir.length + 1)}: ${name}-${rawShade}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('a paleta danger esta completa, do 50 ao 950', () => {
    expect([...(defined.get('danger') ?? [])].sort((a, b) => a - b)).toEqual([
      50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
    ]);
  });
});
