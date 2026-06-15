import { describe, expect, it } from 'vitest';
import { resolveManuallySchema } from '../schema.js';

describe('validation schemas', () => {
  it('accepts manual acceptance notes in snake_case from the frontend', () => {
    const parsed = resolveManuallySchema.parse({
      resolution: 'manual',
      resolution_note: 'Divergencia aceita pelo time de importacao',
    });

    expect(parsed.resolution_note).toBe('Divergencia aceita pelo time de importacao');
  });

  it('does not treat the action field as the required justification', () => {
    const parsed = resolveManuallySchema.safeParse({ resolution: 'manual' });

    expect(parsed.success).toBe(false);
  });
});
