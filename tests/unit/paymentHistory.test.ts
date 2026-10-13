import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { toPaymentRow } from '@/lib/stripe';

function invoice(over: Partial<Stripe.Invoice>): Stripe.Invoice {
  return {
    id: 'in_1',
    number: 'ABC-0001',
    status: 'paid',
    amount_paid: 8900,
    amount_due: 0,
    currency: 'cad',
    created: 1_790_000_000,
    hosted_invoice_url: 'https://invoice.stripe.com/i/x',
    invoice_pdf: 'https://pay.stripe.com/invoice/x/pdf',
    lines: { data: [{ description: '1 x MyJobbs - Month' }] },
    ...over,
  } as unknown as Stripe.Invoice;
}

describe('toPaymentRow', () => {
  it('maps a paid invoice', () => {
    const row = toPaymentRow(invoice({}));
    expect(row).toMatchObject({
      id: 'in_1',
      number: 'ABC-0001',
      amount: 8900,
      currency: 'cad',
      status: 'paid',
      description: '1 x MyJobbs - Month',
      hostedUrl: 'https://invoice.stripe.com/i/x',
      pdfUrl: 'https://pay.stripe.com/invoice/x/pdf',
    });
    expect(row?.date).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it('shows an open invoice as unpaid using the amount due', () => {
    const row = toPaymentRow(invoice({ status: 'open', amount_paid: 0, amount_due: 8900 }));
    expect(row).toMatchObject({ status: 'unpaid', amount: 8900 });
  });

  it('hides drafts, voided and zero-amount invoices', () => {
    expect(toPaymentRow(invoice({ status: 'draft' }))).toBeNull();
    expect(toPaymentRow(invoice({ status: 'void' }))).toBeNull();
    expect(toPaymentRow(invoice({ amount_paid: 0 }))).toBeNull();
  });

  it('falls back to a generic description', () => {
    const row = toPaymentRow(invoice({ lines: { data: [] } as unknown as Stripe.Invoice['lines'] }));
    expect(row?.description).toBe('MyJobbs subscription');
  });
});
