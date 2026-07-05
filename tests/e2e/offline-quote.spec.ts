import { test, expect } from '@playwright/test';

test('quote builder keeps unsynced data through an offline reload, then syncs when back online', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@tiptoptreesltd.com');
  await page.getByLabel('Password').fill('changeme123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');

  await page.goto('/quotes/new');
  await page.getByLabel('Client name').fill('Nelson Costa');
  await page.waitForTimeout(600); // let the 500ms autosave debounce commit before the next field edit
  await page.getByLabel('Client email').fill('nelson.costa@example.com');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.waitForTimeout(600);
  await page.getByLabel('Service title').fill('Hedge trimming');
  await page.waitForTimeout(600);
  await page.getByLabel('Price').fill('250');
  await page.waitForTimeout(700); // allow the final 500ms autosave debounce to fire

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByLabel('Client name')).toHaveValue('Nelson Costa');
  await expect(page.getByTestId('sync-badge')).toHaveText('Local');

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });
});
