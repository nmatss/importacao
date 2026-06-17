import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

vi.mock('../../ai/service.js', () => ({
  aiService: {
    generateOperationalAssistantAnswer: vi.fn(),
  },
}));

vi.mock('../../ai/rag/retriever.js', () => ({
  normalize: (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
  tokenize: (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  retrieveContext: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { assistantService } = await import('../service.js');
const { aiService } = await import('../../ai/service.js');

describe('assistantService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  it('does not return recent data or call AI when no source has positive evidence', async () => {
    const recentProcess = {
      id: 1,
      processCode: 'IM0712602NB',
      status: 'validated',
      logisticStatus: null,
      brand: 'Puket',
      exporterName: 'Exporter',
      importerName: 'Importer',
      portOfLoading: 'Ningbo',
      portOfDischarge: 'Itapoa',
      etd: null,
      eta: null,
      totalFobValue: null,
      notes: null,
      updatedAt: new Date('2026-06-01T00:00:00Z'),
    };

    queryQueue.push(createResolvedChain([recentProcess]));
    queryQueue.push(createResolvedChain([])); // alerts
    queryQueue.push(createResolvedChain([])); // communications
    queryQueue.push(createResolvedChain([])); // email logs
    queryQueue.push(createResolvedChain([])); // validations
    queryQueue.push(createResolvedChain([])); // documents
    queryQueue.push(createResolvedChain([])); // follow-up
    queryQueue.push(createResolvedChain([])); // events

    const result = await assistantService.query(
      { question: 'qual a previsão do campeonato?', limit: 10 },
      { id: 10, role: 'analyst' },
    );

    expect(result.sources).toEqual([]);
    expect(result.mode).toBe('deterministic');
    expect(result.answer).toContain('Não encontrei evidências internas suficientes');
    expect(aiService.generateOperationalAssistantAnswer).not.toHaveBeenCalled();
  });
});
