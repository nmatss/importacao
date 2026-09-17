import { describe, expect, it } from 'vitest';
import {
  domainOf,
  evaluateCorporateAccount,
  formatAllowedDomainsMessage,
  parseAllowedDomains,
} from '../allowed-domain.js';

describe('parseAllowedDomains()', () => {
  it('aceita um unico dominio', () => {
    expect(parseAllowedDomains('grupounico.com')).toEqual(['grupounico.com']);
  });

  it('aceita lista por virgula, ponto e virgula ou espaco', () => {
    expect(parseAllowedDomains('grupounico.com, imaginarium.com; puket.com.br')).toEqual([
      'grupounico.com',
      'imaginarium.com',
      'puket.com.br',
    ]);
  });

  it('normaliza caixa, arroba inicial e duplicatas', () => {
    expect(parseAllowedDomains(' @GrupoUnico.com, GRUPOUNICO.COM , @imaginarium.com ')).toEqual([
      'grupounico.com',
      'imaginarium.com',
    ]);
  });

  it('ignora entradas sem ponto ou com barra', () => {
    expect(parseAllowedDomains('grupounico.com, local, evil.com/phish')).toEqual([
      'grupounico.com',
    ]);
  });

  it('lista vazia nao restringe (compatível com ALLOWED_DOMAIN ausente)', () => {
    expect(parseAllowedDomains('')).toEqual([]);
    expect(parseAllowedDomains('   ,  ; ')).toEqual([]);
  });
});

describe('evaluateCorporateAccount()', () => {
  const allowed = ['grupounico.com', 'imaginarium.com'];

  it('aceita e-mail e hd do dominio primario', () => {
    expect(evaluateCorporateAccount('ana@grupounico.com', 'grupounico.com', allowed).allowed).toBe(
      true,
    );
  });

  it('aceita marca secundaria com hd do Workspace primario', () => {
    // Caso real: conta @imaginarium.com no mesmo Workspace, hd=grupounico.com.
    expect(
      evaluateCorporateAccount('isabela.hoehne@imaginarium.com', 'grupounico.com', allowed).allowed,
    ).toBe(true);
  });

  it('aceita marca secundaria com hd proprio', () => {
    expect(
      evaluateCorporateAccount('isabela.hoehne@imaginarium.com', 'imaginarium.com', allowed)
        .allowed,
    ).toBe(true);
  });

  it('nao recusa por ausencia de hd quando o sufixo e da lista', () => {
    expect(evaluateCorporateAccount('ana@grupounico.com', undefined, allowed).allowed).toBe(true);
    expect(evaluateCorporateAccount('ana@imaginarium.com', null, allowed).allowed).toBe(true);
  });

  it('recusa hd de outra organizacao mesmo com e-mail da lista', () => {
    const result = evaluateCorporateAccount('ana@grupounico.com', 'outraempresa.com', allowed);
    expect(result.allowed).toBe(false);
    expect(result.hostedDomainOk).toBe(false);
    expect(result.emailSuffixOk).toBe(true);
  });

  it('recusa e-mail de fora mesmo com hd corporativo', () => {
    const result = evaluateCorporateAccount('alguem@outraempresa.com', 'grupounico.com', allowed);
    expect(result.allowed).toBe(false);
    expect(result.emailSuffixOk).toBe(false);
  });

  it('sem allowlist, nao restringe', () => {
    expect(evaluateCorporateAccount('alguem@gmail.com', 'gmail.com', []).allowed).toBe(true);
  });
});

describe('formatAllowedDomainsMessage()', () => {
  it('mantem a mensagem historica para um dominio', () => {
    expect(formatAllowedDomainsMessage(['grupounico.com'])).toBe(
      'Acesso restrito a contas @grupounico.com',
    );
  });

  it('lista os dominios aceitos', () => {
    expect(formatAllowedDomainsMessage(['grupounico.com', 'imaginarium.com'])).toBe(
      'Acesso restrito a contas @grupounico.com ou @imaginarium.com',
    );
  });
});

describe('domainOf()', () => {
  it('usa o ultimo arroba e normaliza caixa', () => {
    expect(domainOf('X@Imaginarium.COM')).toBe('imaginarium.com');
  });
});
