// Helpers para ler campos de extração de IA no formato envelope
// { value, confidence } usado em aiParsedData/aiExtractedData.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function unwrapAiValue(value: unknown): unknown {
  if (isRecord(value) && 'value' in value) return value.value;
  return value;
}
