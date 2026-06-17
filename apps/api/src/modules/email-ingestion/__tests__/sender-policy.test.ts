import { describe, expect, it } from 'vitest';
import { extractMailboxAddress, isEmailAllowedByPatterns } from '../sender-policy.js';

describe('email sender policy', () => {
  it('uses the mailbox inside angle brackets instead of display-name substrings', () => {
    expect(extractMailboxAddress('"allowed@example.com" <attacker@evil.test>')).toBe(
      'attacker@evil.test',
    );
    expect(
      isEmailAllowedByPatterns('"allowed@example.com" <attacker@evil.test>', [
        'allowed@example.com',
      ]),
    ).toBe(false);
  });

  it('allows exact mailbox and valid subdomains only', () => {
    expect(isEmailAllowedByPatterns('User <user@example.com>', ['user@example.com'])).toBe(true);
    expect(isEmailAllowedByPatterns('ops@mail.example.com', ['example.com'])).toBe(true);
    expect(isEmailAllowedByPatterns('ops@badexample.com', ['example.com'])).toBe(false);
  });
});
