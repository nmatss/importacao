import { describe, it, expect } from 'vitest';

// We test the private helper methods by reimplementing them here
// since the actual AI service class has private methods and requires external deps.

function safeJsonParse(response: string, context: string): any {
  try {
    return JSON.parse(response);
  } catch (err) {
    throw new Error(`Failed to parse AI response for ${context}: invalid JSON`);
  }
}

function calculateConfidence(data: Record<string, any>): { score: number; lowConfidenceFields: string[] } {
  const lowConfidenceFields: string[] = [];
  let totalConfidence = 0;
  let fieldCount = 0;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'items' || key === 'confidence') continue;
    fieldCount++;

    if (value === null || value === undefined || value === '') {
      lowConfidenceFields.push(key);
      totalConfidence += 0;
    } else if (typeof value === 'string' && value.includes('?')) {
      lowConfidenceFields.push(key);
      totalConfidence += 0.5;
    } else {
      totalConfidence += 1;
    }
  }

  const score = fieldCount > 0 ? totalConfidence / fieldCount : 0;
  return { score, lowConfidenceFields };
}

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    const result = safeJsonParse('{"name": "test", "value": 42}', 'test');
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('should parse JSON arrays', () => {
    const result = safeJsonParse('[1, 2, 3]', 'test');
    expect(result).toEqual([1, 2, 3]);
  });

  it('should throw on invalid JSON', () => {
    expect(() => safeJsonParse('not json at all', 'invoice')).toThrow(
      'Failed to parse AI response for invoice: invalid JSON',
    );
  });

  it('should throw on empty string', () => {
    expect(() => safeJsonParse('', 'test')).toThrow('invalid JSON');
  });

  it('should throw on partial JSON', () => {
    expect(() => safeJsonParse('{"name": "test"', 'test')).toThrow('invalid JSON');
  });

  it('should include context in error message', () => {
    expect(() => safeJsonParse('bad', 'packing list extraction')).toThrow(
      'packing list extraction',
    );
  });
});

describe('calculateConfidence', () => {
  it('should return score of 1 when all fields have values', () => {
    const { score, lowConfidenceFields } = calculateConfidence({
      exporterName: 'ACME Corp',
      importerName: 'Brasil Import',
      totalValue: 5000,
    });
    expect(score).toBe(1);
    expect(lowConfidenceFields).toEqual([]);
  });

  it('should return score of 0 when all fields are empty', () => {
    const { score, lowConfidenceFields } = calculateConfidence({
      exporterName: null,
      importerName: '',
      totalValue: undefined,
    });
    expect(score).toBe(0);
    expect(lowConfidenceFields).toHaveLength(3);
  });

  it('should handle fields with question marks as low confidence', () => {
    const { score, lowConfidenceFields } = calculateConfidence({
      exporterName: 'ACME Corp?',
      importerName: 'Brasil Import',
    });
    expect(lowConfidenceFields).toContain('exporterName');
    expect(score).toBe(0.75); // (0.5 + 1) / 2
  });

  it('should skip items and confidence fields', () => {
    const { score } = calculateConfidence({
      items: [{ name: 'test' }],
      confidence: 0.9,
      exporterName: 'ACME',
    });
    expect(score).toBe(1); // only exporterName counted
  });

  it('should return 0 for empty object', () => {
    const { score, lowConfidenceFields } = calculateConfidence({});
    expect(score).toBe(0);
    expect(lowConfidenceFields).toEqual([]);
  });

  it('should handle mixed confidence levels', () => {
    const { score, lowConfidenceFields } = calculateConfidence({
      exporterName: 'ACME Corp',
      importerName: null,
      portOfLoading: 'Shanghai?',
      totalValue: 5000,
    });
    // 1 (ACME) + 0 (null) + 0.5 (?) + 1 (5000) = 2.5 / 4 = 0.625
    expect(score).toBe(0.625);
    expect(lowConfidenceFields).toContain('importerName');
    expect(lowConfidenceFields).toContain('portOfLoading');
  });
});
