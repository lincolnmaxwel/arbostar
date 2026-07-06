import { describe, it, expect } from 'vitest';
import { formatPhoneInput } from '@/lib/formatPhone';

describe('formatPhoneInput', () => {
  it('formats progressively as digits are typed', () => {
    expect(formatPhoneInput('5')).toBe('(5');
    expect(formatPhoneInput('555')).toBe('(555');
    expect(formatPhoneInput('5551')).toBe('(555) 1');
    expect(formatPhoneInput('555123')).toBe('(555) 123');
    expect(formatPhoneInput('5551234')).toBe('(555) 123-4');
    expect(formatPhoneInput('5551234567')).toBe('(555) 123-4567');
  });

  it('strips non-digit characters (pasted formatted numbers)', () => {
    expect(formatPhoneInput('(555) 123-4567')).toBe('(555) 123-4567');
    expect(formatPhoneInput('555.123.4567')).toBe('(555) 123-4567');
  });

  it('drops digits beyond the 10th instead of overflowing the mask', () => {
    expect(formatPhoneInput('55512345678888')).toBe('(555) 123-4567');
  });

  it('returns empty string for empty input', () => {
    expect(formatPhoneInput('')).toBe('');
  });
});
