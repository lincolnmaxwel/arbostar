'use client';

import { PASSWORD_RULES } from '@/lib/passwordPolicy';

const SEGMENT_COLORS = ['#dc2626', '#ea580c', '#f59e0b', '#84cc16', '#16a34a'];

/**
 * Compact strength meter: one segment per rule, filling and changing colour
 * as rules are met, with a single line naming what is still missing.
 */
export function PasswordRequirements({ password }: { password: string }) {
  const results = PASSWORD_RULES.map((rule) => ({ rule, met: rule.test(password) }));
  const metCount = results.filter((r) => r.met).length;
  const missing = results.filter((r) => !r.met).map((r) => r.rule.short);
  const complete = metCount === PASSWORD_RULES.length;
  const color = SEGMENT_COLORS[Math.max(metCount - 1, 0)];
  const started = password.length > 0;

  let hint = 'Use 6+ characters with upper and lower case, a number and a symbol.';
  if (complete) hint = '✓ Strong password';
  else if (started) hint = `Still needed: ${missing.join(', ')}`;

  return (
    <div style={{ margin: '-4px 0 16px' }}>
      <div
        role="img"
        aria-label={`Password strength: ${metCount} of ${PASSWORD_RULES.length} requirements met`}
        style={{ display: 'grid', gridTemplateColumns: `repeat(${PASSWORD_RULES.length}, 1fr)`, gap: 4 }}
      >
        {PASSWORD_RULES.map((rule, index) => (
          <span
            key={rule.id}
            style={{
              height: 4,
              borderRadius: 2,
              background: index < metCount ? color : 'var(--color-border)',
              transition: 'background 150ms ease',
            }}
          />
        ))}
      </div>
      <p
        aria-live="polite"
        style={{
          margin: '6px 0 0',
          fontSize: '0.8125rem',
          color: complete ? 'var(--color-success, #15803d)' : 'var(--color-text-secondary)',
        }}
      >
        {hint}
      </p>
    </div>
  );
}

/** One-line match indicator for the "confirm password" field. */
export function PasswordMatch({ password, confirm }: { password: string; confirm: string }) {
  if (!confirm) return null;
  const match = password === confirm;
  return (
    <p
      role="status"
      style={{
        margin: '8px 0 0',
        fontSize: '0.8125rem',
        color: match ? 'var(--color-success, #15803d)' : 'var(--color-error)',
      }}
    >
      {match ? '✓ Passwords match' : 'Passwords do not match'}
    </p>
  );
}
