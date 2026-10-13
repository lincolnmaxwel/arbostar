// Password rules for choosing a NEW password (sign-up, invitation, reset).
// Shared by the live checklist in the browser and the API routes, so the two
// can never disagree. Existing passwords are not re-checked at sign-in.

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 200;

export interface PasswordRule {
  id: 'length' | 'lower' | 'upper' | 'number' | 'special';
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { id: 'upper', label: 'One uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'One number (0-9)', test: (p) => /[0-9]/.test(p) },
  { id: 'special', label: 'One special character (e.g. ! @ # $ %)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** First problem as a sentence for API errors, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length > PASSWORD_MAX_LENGTH) return 'Password is too long.';
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(password));
  if (failed.length === 0) return null;
  return `Password must have: ${failed.map((r) => r.label.charAt(0).toLowerCase() + r.label.slice(1)).join(', ')}.`;
}

export function isPasswordValid(password: string): boolean {
  return passwordProblem(password) === null;
}
