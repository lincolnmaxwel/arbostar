import { describe, it, expect } from 'vitest';
import { buildInvoicePdf, InvoicePdfOptions } from '@/lib/invoicePdf';

function baseOptions(): InvoicePdfOptions {
  return {
    invoiceNumber: 1,
    quoteNumber: 52,
    date: new Date('2026-07-07T00:00:00.000Z'),
    client: { name: 'Nelson Costa', email: 'nelson@example.com', phone: '(312) 323-1312', address: null },
    serviceAddress: '3322 University Woods, Victoria, BC',
    company: { name: 'Tip Top Tree Service Ltd', phone: '(250) 857-2420', email: 'info@tiptoptreesltd.com', address: '4115 Holland Ave', logoPath: null },
    items: [
      { title: 'Hedge trim', price: 120 },
      { title: 'Tree removal', description: 'Large oak in the back yard', price: 360 },
    ],
    subtotal: 480,
    taxRate: 0.05,
    taxAmount: 24,
    total: 504,
  };
}

describe('buildInvoicePdf', () => {
  it('produces a valid A4 PDF buffer', async () => {
    const buffer = await buildInvoicePdf(baseOptions());
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('handles an item with no description and one with a description without throwing', async () => {
    await expect(buildInvoicePdf(baseOptions())).resolves.toBeInstanceOf(Buffer);
  });

  it('works with no company info and no service address at all', async () => {
    const opts = baseOptions();
    opts.company = { name: null, phone: null, email: null, address: null, logoPath: null };
    opts.serviceAddress = null;
    const buffer = await buildInvoicePdf(opts);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('skips a missing logo file instead of throwing', async () => {
    const opts = baseOptions();
    opts.company.logoPath = 'this-file-does-not-exist.png';
    const buffer = await buildInvoicePdf(opts);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
