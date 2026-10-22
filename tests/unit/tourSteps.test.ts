import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '@/lib/tourSteps';

describe('tour steps', () => {
  it('starts with a welcome card and ends with a closing card (no target)', () => {
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined();
  });

  it('has unique ids and non-empty English copy', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(2);
      expect(s.text.length).toBeGreaterThan(20);
    }
  });

  it('explains the four Profile blocks first, then the menu pages, in order', () => {
    const targets = TOUR_STEPS.map((s) => s.target).filter(Boolean);
    expect(targets).toEqual([
      'profile-provider',
      'profile-hourly',
      'profile-notifications',
      'profile-password',
      'nav-quotes',
      'nav-new-quote',
      'nav-clients',
      'nav-timesheet',
      'nav-services',
      'nav-invoices',
      'nav-financial',
    ]);
  });

  it('sends the Profile steps to /profile', () => {
    for (const s of TOUR_STEPS.filter((x) => x.target?.startsWith('profile-'))) expect(s.route).toBe('/profile');
  });
});
