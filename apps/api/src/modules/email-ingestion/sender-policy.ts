export function extractMailboxAddress(from: string): string {
  const angleMatch = from.match(/<\s*([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)\s*>/i);
  if (angleMatch) return angleMatch[1].trim().toLowerCase();

  const emailMatch = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return (emailMatch?.[0] ?? from).trim().toLowerCase();
}

export function isEmailAllowedByPatterns(email: string, patterns: string[]): boolean {
  const mailbox = extractMailboxAddress(email);
  const domain = mailbox.includes('@') ? (mailbox.split('@').pop() ?? '') : '';

  return patterns
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern.startsWith('@')) {
        const allowedDomain = pattern.slice(1);
        return domain === allowedDomain || domain.endsWith(`.${allowedDomain}`);
      }
      if (pattern.includes('@')) return mailbox === pattern;
      return domain === pattern || domain.endsWith(`.${pattern}`);
    });
}

export function isAllowedSenderFromEnv(from: string, allowedRaw?: string): boolean {
  if (!allowedRaw) return false;

  const allowed = allowedRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return isEmailAllowedByPatterns(from, allowed);
}
