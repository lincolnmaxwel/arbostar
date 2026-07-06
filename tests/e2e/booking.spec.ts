import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';

const CLIENT_EMAIL = `booking.e2e.${process.pid}@example.com`;
const CLIENT_NAME = 'Booking E2E Client';

test('full booking flow: approve → propose dates → client confirms → staff sees scheduled', async ({ page }) => {
  // 1. Login as admin.
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@tiptoptreesltd.com');
  await page.getByLabel('Password').fill('changeme123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');

  // 2. Create a quote, add one line item, Save and Send.
  await page.goto('/quotes/new');
  await page.waitForURL(/\/quotes\/new\?draft=.+/);
  const draftFromUrl = new URL(page.url()).searchParams.get('draft')!;

  await page.getByLabel('Client name').fill(CLIENT_NAME);
  await page.waitForTimeout(600);
  await page.getByLabel('Client email').fill(CLIENT_EMAIL);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Add service' }).click();
  await page.waitForTimeout(600);
  await page.getByLabel('Service title').fill('Tree removal');
  await page.waitForTimeout(600);
  await page.getByLabel('Price').fill('800');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Save and Send' }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });

  // 3. Look up the quote via the DB to get publicToken + Quote.id.
  const quote = await prisma.quote.findFirstOrThrow({
    where: { client: { email: CLIENT_EMAIL } },
  });
  expect(quote.publicToken).toBeTruthy();

  // 4. Client approves via the portal.
  await page.goto(`/portal/${quote.publicToken}`);
  await expect(page.getByText(/estimate #/i)).toBeVisible();
  await page.getByRole('button', { name: /approve/i }).click();
  await page.waitForURL(`/portal/${quote.publicToken}`);

  // After approval, the portal should show the "Staff will propose scheduling dates shortly" copy
  // (bookingStatus=idle).
  await expect(page.getByText(/staff will propose scheduling dates shortly/i)).toBeVisible();

  // 5. Staff opens the quote view and clicks "Schedule".
  await page.goto(`/quotes/${draftFromUrl}`);
  await expect(page.getByTestId('booking-area')).toBeVisible();
  await page.getByRole('link', { name: /schedule/i }).click();
  await page.waitForURL(/\/quotes\/.*\/booking/);

  // 6. Fill 2 date options and submit.
  const future1 = '2099-07-15';
  const future2 = '2099-07-17';
  const dateInputs = page.getByLabel(/date/i);
  await dateInputs.first().fill(future1);
  await page.getByLabel(/window/i).first().selectOption('morning');
  await page.getByRole('button', { name: /add date/i }).click();
  await dateInputs.nth(1).fill(future2);
  await page.getByLabel(/window/i).nth(1).selectOption('fullday');

  await page.getByRole('button', { name: /send to client/i }).click();
  await page.waitForURL(`/quotes/${draftFromUrl}`);

  // 7. Client opens the portal again — now the BookingPicker should be visible.
  await page.goto(`/portal/${quote.publicToken}`);
  await expect(page.getByRole('radiogroup', { name: /date options/i })).toBeVisible();
  await page.getByLabel(/july 15, 2099/i).check();
  await page.getByRole('button', { name: /confirm date/i }).click();

  // After confirm, the portal should show the "Job scheduled for" banner.
  await expect(page.getByText(/job scheduled for/i)).toBeVisible();
  await expect(page.getByText(/july \d{1,2}, 2099/i)).toBeVisible();
  await expect(page.getByText(/morning/i)).toBeVisible();

  // 8. Staff quote view now shows the scheduled banner.
  await page.goto(`/quotes/${draftFromUrl}`);
  await expect(page.getByTestId('booking-area')).toHaveText(/scheduled/i);
  await expect(page.getByTestId('booking-area')).toHaveText(/july \d{1,2}, 2099/i);
});

test.afterAll(async () => {
  // Clean up the E2E-created quote so re-runs don't accumulate.
  const quotes = await prisma.quote.findMany({ where: { client: { email: CLIENT_EMAIL } } });
  for (const q of quotes) {
    await prisma.quote.delete({ where: { id: q.id } });
  }
  await prisma.client.deleteMany({ where: { email: CLIENT_EMAIL } });
  await prisma.$disconnect();
});
