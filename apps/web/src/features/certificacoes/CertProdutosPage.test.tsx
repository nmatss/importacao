import { describe, it, expect } from 'vitest';
import { matchesStatusFilters } from './CertProdutosPage';
import type { CertProduct } from '@/shared/lib/cert-api-client';

type Semantic = Pick<CertProduct, 'cert_status' | 'site_status' | 'license_status'>;

const product: Semantic = {
  cert_status: 'ATIVO',
  site_status: 'CONFORME',
  license_status: 'VALIDO',
};

describe('matchesStatusFilters', () => {
  it('matches when all filters are empty ("Todos")', () => {
    expect(
      matchesStatusFilters(product, { cert_status: '', site_status: '', license_status: '' }),
    ).toBe(true);
  });

  it('filters on cert_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ATIVO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(true);
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ENCERRADO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(false);
  });

  it('filters on site_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: 'NAO_CONFORME',
        license_status: '',
      }),
    ).toBe(false);
  });

  it('filters on license_status', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: '',
        license_status: 'VALIDO',
      }),
    ).toBe(true);
    expect(
      matchesStatusFilters(product, {
        cert_status: '',
        site_status: '',
        license_status: 'VENCIDO',
      }),
    ).toBe(false);
  });

  it('requires every active axis to match (AND semantics)', () => {
    expect(
      matchesStatusFilters(product, {
        cert_status: 'ATIVO',
        site_status: 'CONFORME',
        license_status: 'VENCIDO',
      }),
    ).toBe(false);
  });

  it('does not match a null axis against an active filter', () => {
    const partial: Semantic = { cert_status: null, site_status: 'CONFORME', license_status: null };
    expect(
      matchesStatusFilters(partial, {
        cert_status: 'ATIVO',
        site_status: '',
        license_status: '',
      }),
    ).toBe(false);
  });
});
