export function normalizeGooglePrivateKey(value: string | undefined): string | undefined {
  if (!value) return value;

  return value
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => (line.endsWith('\\') ? line.slice(0, -1) : line))
    .join('\n');
}
