import { describe, expect, it } from 'vitest';
import { hasUnsupportedAttachmentSkip } from '../attachment-outcomes.js';

describe('email ingestion attachment outcomes', () => {
  it('flags unsupported attachments for an operational alert', () => {
    expect(
      hasUnsupportedAttachmentSkip([
        { status: 'skipped', skipReason: 'Extensao ou tipo real nao suportado' },
      ]),
    ).toBe(true);
  });

  it('does not flag an attachment skipped only because it is a duplicate', () => {
    expect(hasUnsupportedAttachmentSkip([{ status: 'skipped', skipReason: 'duplicate:123' }])).toBe(
      false,
    );
  });
});
