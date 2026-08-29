import { beforeEach, describe, expect, it, vi } from 'vitest';

const isConfigured = vi.fn();
const validateDescription = vi.fn();

vi.mock('../../../integrations/odoo.service.js', () => ({
  odooService: {
    isConfigured: (...args: unknown[]) => isConfigured(...args),
    validateDescription: (...args: unknown[]) => validateDescription(...args),
  },
}));

const { default: descriptionOdooMatch } = await import('../description-odoo-match.js');

const items = [
  { itemCode: 'PI7752Y', description: 'KIDS SOCKS DINO' },
  { itemCode: 'PI7753Y', description: 'KIDS SOCKS STRIPE' },
  { itemCode: 'PI7754Y', description: 'KIDS SOCKS PLAIN' },
];

describe('description-odoo-match', () => {
  beforeEach(() => {
    isConfigured.mockReset().mockResolvedValue(true);
    validateDescription.mockReset();
  });

  it('reports Odoo lookup failures instead of shrinking the checked count', async () => {
    validateDescription.mockImplementation(async (code: string) => {
      if (code === 'PI7753Y') throw new Error('ECONNREFUSED');
      return { isValid: true, odooDescription: 'ok' };
    });

    const result = await descriptionOdooMatch({ invoiceData: { items } });

    // O bug: com `catch {}` vazio o check dizia "Todas as 2 descrições
    // correspondem" escondendo que 1 item nunca foi verificado.
    expect(result.status).toBe('warning');
    expect(result.message).toContain('2 de 3 verificadas');
    expect(result.message).toContain('PI7753Y');
    expect(result.message).not.toContain('Todas as');
  });

  it('passes only when every comparable item was actually verified', async () => {
    validateDescription.mockResolvedValue({ isValid: true, odooDescription: 'ok' });

    const result = await descriptionOdooMatch({ invoiceData: { items } });

    expect(result.status).toBe('passed');
    expect(result.message).toContain('Todas as 3 descrições');
  });

  it('warns when the Odoo lookup fails for every item', async () => {
    validateDescription.mockRejectedValue(new Error('timeout'));

    const result = await descriptionOdooMatch({ invoiceData: { items } });

    expect(result.status).toBe('warning');
    expect(result.message).toContain('Nenhuma descrição pôde ser verificada');
  });

  it('keeps reporting real mismatches, with the coverage attached', async () => {
    validateDescription.mockImplementation(async (code: string) => {
      if (code === 'PI7752Y') return { isValid: false, odooDescription: 'OUTRA COISA' };
      if (code === 'PI7754Y') throw new Error('ECONNREFUSED');
      return { isValid: true, odooDescription: 'ok' };
    });

    const result = await descriptionOdooMatch({ invoiceData: { items } });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('2 de 3 verificadas');
    expect(result.message).toContain('1 indisponíveis');
  });
});
