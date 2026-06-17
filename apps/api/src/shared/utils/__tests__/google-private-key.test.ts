import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeGooglePrivateKey } from '../google-private-key.js';

function privateKeyPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

describe('normalizeGooglePrivateKey', () => {
  it('normalizes single-escaped PEM newlines', () => {
    const pem = privateKeyPem();
    const normalized = normalizeGooglePrivateKey(pem.replace(/\n/g, '\\n'));

    expect(() => createPrivateKey(normalized!)).not.toThrow();
  });

  it('normalizes double-escaped PEM newlines generated from SOPS env files', () => {
    const pem = privateKeyPem();
    const normalized = normalizeGooglePrivateKey(pem.replace(/\n/g, '\\\\n'));

    expect(normalized?.split('\n')[0]).toBe('-----BEGIN PRIVATE KEY-----');
    expect(normalized?.split('\n')[0].endsWith('\\')).toBe(false);
    expect(() => createPrivateKey(normalized!)).not.toThrow();
  });
});
