import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  computeDurationMinutes,
  computeTimesheetTotals,
  laborAmount,
  productLineAmount,
  validateEntryTimes,
  validateProducts,
  validateTaxRate,
} from '@/lib/timesheetMath';

describe('timesheetMath', () => {
  it('computes whole-minute duration', () => {
    expect(computeDurationMinutes(new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T10:30:00Z'))).toBe(150);
    expect(computeDurationMinutes(new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T08:00:30Z'))).toBe(1);
  });

  it('validates end-after-start', () => {
    expect(validateEntryTimes(new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T10:00:00Z'))).toBeNull();
    expect(validateEntryTimes(new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T08:00:00Z'))).toBe('endedAt must be after startedAt.');
    expect(validateEntryTimes(new Date('2026-09-01T08:00:00Z'), new Date('2026-09-01T08:00:00Z'))).toBe('endedAt must be after startedAt.');
  });

  it('computes labor amount from Decimal rate × hours, rounded to cents', () => {
    const rate = new Prisma.Decimal('65.50');
    expect(laborAmount(rate, 150).toString()).toBe('163.75');
    expect(laborAmount(new Prisma.Decimal('40'), 480).toFixed(2)).toBe('320.00');
  });

  it('computes product line totals with Decimal-safe multiplication', () => {
    expect(productLineAmount(2.5, 12.34).toString()).toBe('30.85');
    expect(productLineAmount(1, 100).toFixed(2)).toBe('100.00');
  });

  it('computes subtotal/tax/total from labor + products', () => {
    const totals = computeTimesheetTotals(
      {
        hourlyRate: new Prisma.Decimal('50'),
        startedAt: new Date('2026-09-01T08:00:00Z'),
        endedAt: new Date('2026-09-01T10:00:00Z'),
        products: [
          { name: 'Chips', quantity: 2, unitPrice: 25 },
          { name: 'Disposal', quantity: 1, unitPrice: 40 },
        ],
      },
      0.05,
    );
    expect(totals.durationMinutes).toBe(120);
    expect(totals.laborAmount.toFixed(2)).toBe('100.00');
    expect(totals.productAmounts.map((a) => a.toFixed(2))).toEqual(['50.00', '40.00']);
    expect(totals.subtotal.toFixed(2)).toBe('190.00');
    expect(totals.taxAmount.toFixed(2)).toBe('9.50');
    expect(totals.total.toFixed(2)).toBe('199.50');
  });

  it('validates tax rates', () => {
    expect(validateTaxRate(0.05)).toBeNull();
    expect(validateTaxRate(0)).toBeNull();
    expect(validateTaxRate(1)).toBeNull();
    expect(validateTaxRate(-0.1)).toBe('Tax rate must be between 0 and 1.');
    expect(validateTaxRate(1.1)).toBe('Tax rate must be between 0 and 1.');
  });

  it('validates products: names, positive quantities, non-negative prices', () => {
    expect(validateProducts([{ name: 'Chips', quantity: 1, unitPrice: 10 }])).toBeNull();
    expect(validateProducts([{ name: '', quantity: 1, unitPrice: 10 }])).toBe('Product name is required.');
    expect(validateProducts([{ name: 'Chips', quantity: 0, unitPrice: 10 }])).toBe('Product quantity must be positive.');
    expect(validateProducts([{ name: 'Chips', quantity: -2, unitPrice: 10 }])).toBe('Product quantity must be positive.');
    expect(validateProducts([{ name: 'Chips', quantity: 1, unitPrice: -5 }])).toBe('Product unit price cannot be negative.');
  });
});