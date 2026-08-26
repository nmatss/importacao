const SIMPLE_EMAIL = /^[^\s@<>(),:;]+@[^\s@<>(),:;]+\.[^\s@<>(),:;]+$/;

/**
 * Accepts either a bare mailbox or one RFC-2822-style display name followed by
 * exactly one mailbox. Groups, lists and control characters are deliberately
 * rejected because this value becomes the SMTP envelope sender.
 */
export function parseMailFrom(value: string): { header: string; address: string } | undefined {
  const candidate = value.trim();
  if (!candidate || /[\r\n\0]/.test(candidate)) return undefined;

  if (SIMPLE_EMAIL.test(candidate)) {
    return { header: candidate, address: candidate.toLowerCase() };
  }

  const match = /^(?:"[^"<>\r\n]*"|[^"<>,:;\r\n]+)\s*<([^<>\s]+)>$/.exec(candidate);
  const address = match?.[1]?.trim();
  if (!address || !SIMPLE_EMAIL.test(address)) return undefined;

  return { header: candidate, address: address.toLowerCase() };
}

export function isValidMailFrom(value: string): boolean {
  return parseMailFrom(value) !== undefined;
}
