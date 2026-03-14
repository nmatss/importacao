import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb, createResolvedChain } from '../../../__tests__/helpers/mock-db.js';

const { mockDb, queryQueue } = createMockDb();

vi.mock('../../../shared/database/connection.js', () => ({
  db: mockDb,
}));

const { settingsService } = await import('../service.js');

describe('settingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryQueue.length = 0;
  });

  describe('get()', () => {
    it('should return setting by key', async () => {
      const mockSetting = {
        id: 1,
        key: 'webhook_url',
        value: 'https://example.com',
        description: 'Webhook',
      };

      queryQueue.push(createResolvedChain([mockSetting]));

      const result = await settingsService.get('webhook_url');

      expect(result).toEqual(mockSetting);
    });

    it('should return undefined when key does not exist', async () => {
      queryQueue.push(createResolvedChain([]));

      const result = await settingsService.get('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getAll()', () => {
    it('should return all settings', async () => {
      const mockSettings = [
        { id: 1, key: 'setting1', value: 'value1' },
        { id: 2, key: 'setting2', value: 'value2' },
      ];

      queryQueue.push(createResolvedChain(mockSettings));

      const result = await settingsService.getAll();

      expect(result).toEqual(mockSettings);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no settings exist', async () => {
      queryQueue.push(createResolvedChain([]));

      const result = await settingsService.getAll();

      expect(result).toEqual([]);
    });
  });

  describe('set()', () => {
    it('should update existing setting', async () => {
      const existingSetting = { id: 1, key: 'webhook_url', value: 'old_value' };
      const updatedSetting = {
        id: 1,
        key: 'webhook_url',
        value: 'new_value',
        description: 'Updated',
      };

      // get() - select existing
      queryQueue.push(createResolvedChain([existingSetting]));
      // update returning
      queryQueue.push(createResolvedChain([updatedSetting]));

      const result = await settingsService.set('webhook_url', 'new_value', 'Updated');

      expect(result).toEqual(updatedSetting);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should create new setting when key does not exist', async () => {
      const newSetting = { id: 3, key: 'new_key', value: 'new_value', description: 'New setting' };

      // get() - select returns empty
      queryQueue.push(createResolvedChain([]));
      // insert returning
      queryQueue.push(createResolvedChain([newSetting]));

      const result = await settingsService.set('new_key', 'new_value', 'New setting');

      expect(result).toEqual(newSetting);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
