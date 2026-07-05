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
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });
});

test('starting a new quote after a previous one was sent does not resume/overwrite it', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@tiptoptreesltd.com');
  await page.getByLabel('Password').fill('changeme123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');

  // First "New quote" click: fill in and fully send a quote for customer A.
  await page.goto('/quotes/new');
  await page.waitForURL(/\/quotes\/new\?draft=.+/);
  const firstDraftUrl = new URL(page.url());
  const firstDraftId = firstDraftUrl.searchParams.get('draft');
  expect(firstDraftId).toBeTruthy();

  await page.getByLabel('Client name').fill('Customer A');
  await page.waitForTimeout(600);
  await page.getByLabel('Client email').fill('customer.a@example.com');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.waitForTimeout(600);
  await page.getByLabel('Service title').fill('Tree removal');
  await page.waitForTimeout(600);
  await page.getByLabel('Price').fill('500');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });

  // Second "New quote" click: a fresh navigation to /quotes/new (no draft param),
  // simulating clicking the "New quote" link again from /quotes.
  await page.goto('/quotes/new');
  await page.waitForURL(/\/quotes\/new\?draft=.+/);
  const secondDraftUrl = new URL(page.url());
  const secondDraftId = secondDraftUrl.searchParams.get('draft');
  expect(secondDraftId).toBeTruthy();

  // The core regression: the second draft must be a genuinely new, independent
  // draft id, not the first (already-synced) customer's draft id.
  expect(secondDraftId).not.toBe(firstDraftId);

  // And the form should be empty, not resuming customer A's already-sent data.
  await expect(page.getByLabel('Client name')).toHaveValue('');
  await expect(page.getByLabel('Client email')).toHaveValue('');

  // Fill in customer B and send, then confirm customer A's quote was not overwritten.
  await page.getByLabel('Client name').fill('Customer B');
  await page.waitForTimeout(600);
  await page.getByLabel('Client email').fill('customer.b@example.com');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.waitForTimeout(600);
  await page.getByLabel('Service title').fill('Stump grinding');
  await page.waitForTimeout(600);
  await page.getByLabel('Price').fill('150');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });

  await page.goto('/quotes');
  await expect(page.getByText('Customer A')).toBeVisible();
  await expect(page.getByText('Customer B')).toBeVisible();
});
