import { describe, it, expect } from 'vitest';
import { calculateTotals } from '@/lib/quoteMath';

describe('calculateTotals', () => {
  it('computes subtotal, tax, and total', () => {
    const result = calculateTotals([{ price: 1250 }, { price: 500 }], 0.05);
    expect(result).toEqual({ subtotal: 1750, taxAmount: 87.5, total: 1837.5 });
  });

  it('handles an empty item list', () => {
    expect(calculateTotals([], 0.05)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });
});
