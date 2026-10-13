import { describe, it, expect } from 'vitest';
import { isPasswordValid, passwordProblem } from '@/lib/passwordPolicy';

describe('passwordPolicy', () => {
  it('accepts a password with upper, lower, number and special character', () => {
    expect(isPasswordValid('Abcd1!')).toBe(true);
    expect(passwordProblem('Correct-Horse9')).toBeNull();
  });

  it.each([
    ['Ab1!', 'at least 6 characters'],
    ['abcdef1!', 'uppercase'],
    ['ABCDEF1!', 'lowercase'],
    ['Abcdefg!', 'number'],
    ['Abcdefg1', 'special character'],
  ])('rejects %s and names the missing rule', (password, fragment) => {
    expect(isPasswordValid(password)).toBe(false);
    expect(passwordProblem(password)).toContain(fragment);
  });

  it('rejects an over-long password', () => {
    expect(passwordProblem('Aa1!' + 'x'.repeat(250))).toBe('Password is too long.');
  });
});
