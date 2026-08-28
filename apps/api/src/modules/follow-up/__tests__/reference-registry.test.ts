import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockReadProcessReferences = vi.fn();

const mockIsConfigured = vi.fn(() => true);

vi.mock('../../integrations/google-sheets.service.js', () => ({
  googleSheetsService: {
    readProcessReferences: (...args: unknown[]) => mockReadProcessReferences(...args),
    isConfigured: () => mockIsConfigured(),
  },
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  getReferenceSource,
  normalizeReference,
  resolveFollowUpReference,
  getFollowUpReferences,
  filterCandidatesByFollowUp,
  __resetFollowUpReferenceCache,
} = await import('../reference-registry.js');

describe('Follow Up reference allow-list', () => {
  beforeEach(() => {
    __resetFollowUpReferenceCache();
    mockReadProcessReferences.mockReset();
    mockIsConfigured.mockReset();
    mockIsConfigured.mockReturnValue(true);
    delete process.env.PROCESS_REFERENCE_SOURCE;
    delete process.env.FOLLOW_UP_REFERENCE_TTL_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getReferenceSource()', () => {
    it('defaults to the Follow Up sheet', () => {
      expect(getReferenceSource()).toBe('follow_up');
    });

    it('honours the legacy escape hatch the user asked us to keep', () => {
      process.env.PROCESS_REFERENCE_SOURCE = 'legacy';
      expect(getReferenceSource()).toBe('legacy');
    });

    it('treats any other value as follow_up rather than silently disabling the gate', () => {
      process.env.PROCESS_REFERENCE_SOURCE = 'typo';
      expect(getReferenceSource()).toBe('follow_up');
    });

    it('fails closed when the sheet was never configured', () => {
      // A planilha e a autoridade solicitada pela operacao. Voltar para o
      // regex/IA sem configuracao recria silenciosamente referencias de item
      // e referencias truncadas.
      mockIsConfigured.mockReturnValue(false);
      expect(getReferenceSource()).toBe('follow_up');
    });
  });

  describe('normalizeReference()', () => {
    it('ignores the separators people type by hand', () => {
      expect(normalizeReference(' im-0712602 nb ')).toBe('IM0712602NB');
      expect(normalizeReference('PK_2042602/NB')).toBe('PK2042602NB');
    });

    it('keeps the suffix that distinguishes two real processes', () => {
      expect(normalizeReference('PK2052602TJ')).not.toBe(normalizeReference('PK2052602NB'));
    });
  });

  describe('resolveFollowUpReference()', () => {
    it('accepts a listed reference and returns the sheet spelling', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB', 'PK2042602NB']);

      await expect(resolveFollowUpReference('im0712602nb')).resolves.toEqual({
        status: 'allowed',
        canonical: 'IM0712602NB',
        stale: false,
      });
    });

    it('rejects an item code that never appears in the sheet', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB']);

      const decision = await resolveFollowUpReference('PI7223Y');
      expect(decision.status).toBe('not_listed');
      expect(decision.canonical).toBeUndefined();
    });

    it('rejects a truncated reference instead of matching the complete one', async () => {
      // The old substring match linked PK2052602 to PK2052602TJ. That is the
      // "referencia incompleta" the user reported.
      mockReadProcessReferences.mockResolvedValue(['PK2052602TJ']);

      await expect(resolveFollowUpReference('PK2052602')).resolves.toMatchObject({
        status: 'not_listed',
      });
    });

    it('reports unavailable — never "not listed" — when the sheet cannot be read', async () => {
      mockReadProcessReferences.mockRejectedValue(new Error('403 from Sheets'));

      await expect(resolveFollowUpReference('IM0712602NB')).resolves.toEqual({
        status: 'unavailable',
      });
    });

    it('serves the last good list when the sheet goes down mid-flight', async () => {
      mockReadProcessReferences.mockResolvedValueOnce(['IM0712602NB']);
      await resolveFollowUpReference('IM0712602NB');

      process.env.FOLLOW_UP_REFERENCE_TTL_MS = '1';
      await new Promise((resolve) => setTimeout(resolve, 5));
      mockReadProcessReferences.mockRejectedValue(new Error('network down'));

      await expect(resolveFollowUpReference('IM0712602NB')).resolves.toEqual({
        status: 'allowed',
        canonical: 'IM0712602NB',
        stale: true,
      });
    });

    it('does not treat an empty candidate as a lookup', async () => {
      await expect(resolveFollowUpReference('   ')).resolves.toEqual({ status: 'not_listed' });
      expect(mockReadProcessReferences).not.toHaveBeenCalled();
    });
  });

  describe('filterCandidatesByFollowUp()', () => {
    it('separa o que a planilha conhece do que ela nao conhece', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB', 'PK2042602NB']);

      await expect(
        filterCandidatesByFollowUp(['PI7223Y', 'im0712602nb', 'INV-2025-00123']),
      ).resolves.toEqual({
        status: 'applied',
        canonical: ['IM0712602NB'],
        rejected: ['PI7223Y', 'INV-2025-00123'],
      });
    });

    it('rejeita tudo quando nenhum candidato consta na planilha', async () => {
      // Este e o caso que o chamador PRECISA conseguir distinguir: rejeitar
      // tudo em silencio deixava o e-mail cair sem alerta nenhum.
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB']);

      const out = await filterCandidatesByFollowUp(['PI7223Y', 'PK9999999ZZ']);
      expect(out.status).toBe('applied');
      expect(out.canonical).toEqual([]);
      expect(out.rejected).toEqual(['PI7223Y', 'PK9999999ZZ']);
    });

    it('nao deduz nada quando o allow-list esta indisponivel', async () => {
      mockReadProcessReferences.mockRejectedValue(new Error('403'));

      await expect(filterCandidatesByFollowUp(['IM0712602NB'])).resolves.toEqual({
        status: 'unavailable',
        canonical: [],
        rejected: [],
      });
    });

    it('nao duplica quando dois candidatos apontam para a mesma referencia', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB']);

      const out = await filterCandidatesByFollowUp(['IM0712602NB', 'im-0712602-nb']);
      expect(out.canonical).toEqual(['IM0712602NB']);
    });

    it('preserva a ordem em que os candidatos foram propostos', async () => {
      mockReadProcessReferences.mockResolvedValue(['PK2042602NB', 'IM0712602NB']);

      const out = await filterCandidatesByFollowUp(['IM0712602NB', 'PK2042602NB']);
      expect(out.canonical).toEqual(['IM0712602NB', 'PK2042602NB']);
    });
  });

  describe('getFollowUpReferences()', () => {
    it('caches within the TTL instead of hitting Sheets per e-mail', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB']);

      await getFollowUpReferences();
      await getFollowUpReferences();
      await getFollowUpReferences();

      expect(mockReadProcessReferences).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent refreshes into a single Sheets call', async () => {
      mockReadProcessReferences.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(['IM0712602NB']), 5)),
      );

      await Promise.all([
        getFollowUpReferences(),
        getFollowUpReferences(),
        getFollowUpReferences(),
      ]);

      expect(mockReadProcessReferences).toHaveBeenCalledTimes(1);
    });

    it('keeps the first spelling when the sheet repeats a reference', async () => {
      mockReadProcessReferences.mockResolvedValue(['IM0712602NB', 'im0712602nb']);

      const snapshot = await getFollowUpReferences();
      expect(snapshot?.byNormalized.get('IM0712602NB')).toBe('IM0712602NB');
      expect(snapshot?.byNormalized.size).toBe(1);
    });

    it('returns null — not an empty allow-list — when nothing can be established', async () => {
      mockReadProcessReferences.mockRejectedValue(new Error('unconfigured'));
      await expect(getFollowUpReferences()).resolves.toBeNull();
    });
  });
});
