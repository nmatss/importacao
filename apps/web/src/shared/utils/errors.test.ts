import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('Something went wrong'))).toBe('Something went wrong');
  });

  it('returns string directly if error is a string', () => {
    expect(getErrorMessage('Network error')).toBe('Network error');
  });

  it('returns message from plain object with message field', () => {
    expect(getErrorMessage({ message: 'API failed' })).toBe('API failed');
  });

  it('returns fallback for null', () => {
    expect(getErrorMessage(null)).toBe('Ocorreu um erro inesperado');
  });

  it('returns fallback for undefined', () => {
    expect(getErrorMessage(undefined)).toBe('Ocorreu um erro inesperado');
  });

  it('returns fallback for number', () => {
    expect(getErrorMessage(42)).toBe('Ocorreu um erro inesperado');
  });

  it('returns fallback for object without message field', () => {
    expect(getErrorMessage({ code: 500 })).toBe('Ocorreu um erro inesperado');
  });

  it('handles empty string error', () => {
    expect(getErrorMessage('')).toBe('');
  });
});
