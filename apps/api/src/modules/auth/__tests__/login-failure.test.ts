import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuditLog = vi.fn();

vi.mock('../../audit/service.js', () => ({
  auditService: { log: (...a: unknown[]) => mockAuditLog(...a) },
}));
vi.mock('../../../shared/database/connection.js', () => ({ db: {} }));
vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../integrations/google-groups.service.js', () => ({
  googleGroupsService: { isAllowed: vi.fn() },
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'x'.repeat(32);

const { recordLoginFailure, domainOf } = await import('../service.js');

/**
 * Ate 17/08 apenas o caso `not_in_group` deixava rastro de login malsucedido.
 * A falha de REDE — a que derrubou o acesso por 12 dias em 08/2026 — sumia sem
 * registro, e o unico detector virou a usuaria reclamando no WhatsApp.
 */
describe('registro de tentativa de login malsucedida', () => {
  beforeEach(() => {
    mockAuditLog.mockReset();
    mockAuditLog.mockResolvedValue(undefined);
  });

  describe('domainOf()', () => {
    it('extrai o dominio', () => {
      expect(domainOf('alguem@fornecedor.com')).toBe('fornecedor.com');
    });

    it('normaliza caixa', () => {
      expect(domainOf('X@Fornecedor.COM')).toBe('fornecedor.com');
    });

    it('nao quebra com entrada sem arroba', () => {
      expect(domainOf('sem-arroba')).toBe('desconhecido');
    });
  });

  describe('recordLoginFailure()', () => {
    it('grava o motivo com a acao login_failed', async () => {
      await recordLoginFailure(null, 'network_error');

      expect(mockAuditLog).toHaveBeenCalledWith(
        null,
        'login_failed',
        'user',
        null,
        { reason: 'network_error' },
        null,
      );
    });

    it('associa ao usuario quando ele e conhecido', async () => {
      await recordLoginFailure(4, 'inactive_user', 'odett.hammes@grupounico.com');

      const [userId, action, , entityId, details] = mockAuditLog.mock.calls[0];
      expect(userId).toBe(4);
      expect(action).toBe('login_failed');
      expect(entityId).toBe(4);
      expect(details).toEqual({
        reason: 'inactive_user',
        origem: 'odett.hammes@grupounico.com',
      });
    });

    it('para dominio de fora guarda so o dominio, nunca o endereco', async () => {
      // LGPD: e pessoa que nao e nossa; o dominio basta para investigar.
      await recordLoginFailure(null, 'wrong_domain', domainOf('alguem@outraempresa.com'));

      const details = mockAuditLog.mock.calls[0][4];
      expect(details.origem).toBe('outraempresa.com');
      expect(JSON.stringify(details)).not.toContain('alguem');
    });

    it('nao lanca quando a propria auditoria falha', async () => {
      // Instrumentacao nao pode derrubar o fluxo que observa.
      mockAuditLog.mockRejectedValue(new Error('banco fora'));

      await expect(recordLoginFailure(null, 'invalid_token')).resolves.toBeUndefined();
    });
  });
});
