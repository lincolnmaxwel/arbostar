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

  it('shows how to reach Profile, explains its four blocks, then opens each page, in order', () => {
    expect(TOUR_STEPS.map((s) => s.target).filter(Boolean)).toEqual([
      'user-menu',
      'menu-profile',
      'profile-provider',
      'profile-hourly',
      'profile-notifications',
      'profile-password',
      'page-quotes',
      'page-new-quote',
      'page-clients',
      'page-timesheet',
      'page-services',
      'page-invoices',
      'page-financial',
    ]);
  });

  it('opens the account menu for the Profile entry and sends Profile blocks to /profile', () => {
    expect(TOUR_STEPS.find((s) => s.id === 'menu-profile')?.openMenu).toBe(true);
    for (const s of TOUR_STEPS.filter((x) => x.target?.startsWith('profile-'))) {
      expect(s.route).toBe('/profile');
      expect(s.interactive).toBe(true); // the user can fill the block in during the tour
    }
  });

  it('opens every page through its menu link, gated by the account features', () => {
    for (const s of TOUR_STEPS.filter((x) => x.target?.startsWith('page-'))) {
      expect(s.route).toMatch(/^\//);
      expect(s.via).toMatch(/^nav-/);
      expect(s.requires?.length).toBeGreaterThan(0);
    }
  });
});
