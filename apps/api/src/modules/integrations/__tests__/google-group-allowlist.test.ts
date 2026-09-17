import { describe, expect, it } from 'vitest';
import { parseAllowedGroups } from '../google-group-allowlist.js';

describe('parseAllowedGroups()', () => {
  it('aceita um unico grupo', () => {
    expect(parseAllowedGroups('importacao.aut@grupounico.com')).toEqual([
      'importacao.aut@grupounico.com',
    ]);
  });

  it('aceita lista e normaliza caixa', () => {
    expect(
      parseAllowedGroups(
        'importacao.aut@grupounico.com, Importacao@GrupoUnico.com ; importacao.aut@grupounico.com',
      ),
    ).toEqual(['importacao.aut@grupounico.com', 'importacao@grupounico.com']);
  });

  it('ignora entradas sem e-mail de grupo', () => {
    expect(parseAllowedGroups('Portal Importacao, importacao.aut@grupounico.com')).toEqual([
      'importacao.aut@grupounico.com',
    ]);
  });

  it('lista vazia permanece fail-closed', () => {
    expect(parseAllowedGroups('')).toEqual([]);
    expect(parseAllowedGroups('   ,  ; ')).toEqual([]);
  });
});
