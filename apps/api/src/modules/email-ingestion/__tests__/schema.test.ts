import { describe, expect, it } from 'vitest';
import { historyScanSchema, triggerCheckSchema } from '../schema.js';

describe('email ingestion query schemas', () => {
  it('parses "false" query booleans as false', () => {
    expect(triggerCheckSchema.parse({ includeRead: 'false', allSenders: 'false' })).toMatchObject({
      includeRead: false,
      allSenders: false,
    });
  });

  it('parses "true" query booleans as true', () => {
    expect(triggerCheckSchema.parse({ includeRead: 'true', allSenders: 'true' })).toMatchObject({
      includeRead: true,
      allSenders: true,
    });
    expect(historyScanSchema.parse({ months: '3', allSenders: 'true' })).toMatchObject({
      months: 3,
      allSenders: true,
    });
  });
});
