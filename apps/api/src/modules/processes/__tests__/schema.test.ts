import { describe, expect, it } from 'vitest';
import { processFilterSchema } from '../schema.js';

describe('processFilterSchema', () => {
  it('normalizes pagination defaults for process search endpoints', () => {
    expect(processFilterSchema.parse({})).toMatchObject({ page: 1, limit: 20 });
    expect(
      processFilterSchema.parse({ page: '2', limit: '20', search: 'PK2052602TJ' }),
    ).toMatchObject({
      page: 2,
      limit: 20,
      search: 'PK2052602TJ',
    });
  });

  it('rejects an oversized process option request', () => {
    expect(processFilterSchema.safeParse({ page: '1', limit: '500' }).success).toBe(false);
  });
});
