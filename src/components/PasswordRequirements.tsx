'use client';

import { PASSWORD_RULES } from '@/lib/passwordPolicy';

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '-4px 0 16px',
  padding: 0,
  display: 'grid',
  gap: 4,
  fontSize: '0.8125rem',
};

/** Live checklist of the password rules; each line turns green as it is met. */
export function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul style={listStyle} aria-label="Password requirements" aria-live="polite">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: met ? 'var(--color-success, #15803d)' : 'var(--color-text-secondary)',
            }}
          >
            <span aria-hidden="true" style={{ width: 16, textAlign: 'center', fontWeight: 700 }}>
              {met ? '✓' : '○'}
            </span>
            <span>
              {rule.label}
              <span style={{ position: 'absolute', left: -9999 }}>{met ? ' (met)' : ' (not met)'}</span>
            </span>
          </li>
        );
      })}
    </ul>
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
