import { describe, it, expect } from 'vitest';
import { cosineSimilarity, EMBEDDING_DIM } from '../embeddings.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });

  it('ranks a closer vector higher than a farther one', () => {
    const q = [1, 1, 0];
    const near = [0.9, 1.1, 0];
    const far = [0, 0, 1];
    expect(cosineSimilarity(q, near)).toBeGreaterThan(cosineSimilarity(q, far));
  });

  it('guards against length mismatch and zero vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('exposes the bge-m3 dimensionality', () => {
    expect(EMBEDDING_DIM).toBe(1024);
  });
});
