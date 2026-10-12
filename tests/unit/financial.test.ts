import { describe, it, expect } from 'vitest';
import { resolvePeriod } from '@/lib/financial';

function ok(input: Parameters<typeof resolvePeriod>[0]) {
  const r = resolvePeriod(input);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('resolvePeriod', () => {
  it('daily covers exactly one day', () => {
    const p = ok({ preset: 'daily', date: '2026-10-12' });
    expect(p.from.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(p.label).toBe('Oct 12, 2026');
  });

  it('weekly runs Monday to Sunday around the anchor', () => {
    // 2026-10-14 is a Wednesday.
    const p = ok({ preset: 'weekly', date: '2026-10-14' });
    expect(p.from.toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    // A Sunday belongs to the week that started the previous Monday.
    const sunday = ok({ preset: 'weekly', date: '2026-10-18' });
    expect(sunday.from.toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('monthly and yearly cover the whole calendar unit', () => {
    const m = ok({ preset: 'monthly', date: '2026-02-17' });
    expect(m.from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(m.to.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    const y = ok({ preset: 'yearly', date: '2026-06-30' });
    expect(y.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(y.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('custom range is inclusive of the end day', () => {
    const p = ok({ preset: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(p.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(p.label).toBe('Oct 1, 2026 – Oct 31, 2026');
  });

  it('shifts boundaries by the viewer time zone offset', () => {
    // UTC-7 (offset +420): local midnight is 07:00 UTC.
    const p = ok({ preset: 'daily', date: '2026-10-12', tzOffsetMinutes: 420 });
    expect(p.from.toISOString()).toBe('2026-10-12T07:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-13T07:00:00.000Z');
  });

  it('rejects bad input', () => {
    expect('error' in resolvePeriod({ preset: 'daily', date: 'nope' })).toBe(true);
    expect('error' in resolvePeriod({ preset: 'daily', date: '2026-02-31' })).toBe(true);
    expect('error' in resolvePeriod({ preset: 'custom', from: '2026-10-05', to: '2026-10-01' })).toBe(true);
    expect('error' in resolvePeriod({ preset: 'custom', from: '2026-10-05' })).toBe(true);
    expect('error' in resolvePeriod({ preset: 'daily', date: '2026-10-12', tzOffsetMinutes: NaN })).toBe(true);
  });
});
