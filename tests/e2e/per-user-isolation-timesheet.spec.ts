import { test, expect, Page } from '@playwright/test';
import { E2E_STAFF_A, E2E_STAFF_B, E2E_PASSWORD } from './global-setup';

async function signIn(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');
}

test('navigation hides disabled features and shows enabled ones per user', async ({ page }) => {
  // User A has all optional features: all links visible.
  await signIn(page, E2E_STAFF_A);
  await expect(page.getByRole('link', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Timesheet', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Invoices', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quotes', exact: true })).toBeVisible();

  // User B has every optional feature disabled, including quotes: only the
  // hard surfaces (login-required pages) remain, and nav hides the Quotes link.
  await signIn(page, E2E_STAFF_B);
  await expect(page.getByRole('link', { name: 'Quotes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Clients', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Timesheet', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Invoices', exact: true })).toHaveCount(0);
});

test('timesheet entry snapshots the changed hourly-rate default, generates one invoice, and blocks reuse', async ({
  page,
}) => {
  await signIn(page, E2E_STAFF_A);

  // Change the default hourly rate to 99 (profile > Default hourly rate).
  await page.goto('/profile');
  await page.getByLabel('Hourly rate ($)').fill('99');
  await page
    .locator('form')
    .filter({ hasText: 'Hourly rate ($)' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // Create an entry on the seeded client; the row must snapshot the new rate.
  await page.goto('/timesheet');
  await page.getByLabel('Client').first().selectOption({ label: 'E2E Client' });
  await page.getByLabel('Work date').fill('2026-09-10');
  await page.getByLabel('Start time').fill('09:00');
  await page.getByLabel('End time').fill('13:00');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('Entry saved.')).toBeVisible();
  // The new row snapshots the changed default rate (the seeded row keeps $75).
  await expect(page.getByRole('cell', { name: '$99.00/hr' }).first()).toBeVisible();

  // Select the seeded open entry + the new one, generate one invoice.
  const seededCheckbox = page.getByLabel(/Select entry for E2E Client on 2026-09-01/).first();
  const newCheckbox = page.getByLabel(/Select entry for E2E Client on 2026-09-10/).first();
  await seededCheckbox.check();
  await newCheckbox.check();
  await page.getByRole('button', { name: /generate invoice \(2 selected\)/i }).click();
  await expect(page.getByText(/Invoice #\d+ created and emailed/)).toBeVisible();

  // Both entries are now Invoiced and can no longer be selected for reuse.
  await expect(page.getByText('Invoiced').first()).toBeVisible();
  await expect(seededCheckbox).toBeDisabled();
  await expect(newCheckbox).toBeDisabled();
  // No open entries remain, so the generate bar disappears entirely.
  await expect(page.getByRole('button', { name: /generate invoice/i })).toHaveCount(0);
});

test('admin view-as shows the target user\'s data and exits cleanly', async ({ page }) => {
  await signIn(page, 'admin@tiptoptreesltd.com', 'changeme123');

  // Admin sees their own (empty-ish) timesheet; view-as switches to Staff A.
  await page.goto('/timesheet');
  await page.getByRole('button', { name: 'View as' }).click();
  await page.getByRole('menuitem', { name: /E2E Staff A/ }).click();
  await page.waitForURL('/quotes');

  await expect(page.getByTestId('viewing-as-indicator')).toHaveText(/Viewing as E2E Staff A/);

  // The visible data is the target user's: their timesheet entries appear.
  await page.goto('/timesheet');
  await expect(page.getByLabel(/Select entry for E2E Client/).first()).toBeVisible();

  // Stop viewing restores the admin's own scope.
  await page.getByRole('button', { name: 'Stop viewing' }).click();
  await page.waitForURL('/quotes');
  await expect(page.getByTestId('viewing-as-indicator')).toHaveCount(0);
});