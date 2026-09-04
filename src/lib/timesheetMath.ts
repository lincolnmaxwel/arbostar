import { Prisma } from '@prisma/client';

export interface TimesheetProductInput {
  name: string;
  quantity: number;
  unitPrice: number;
}

/** Whole-minute duration, rounded to the nearest minute. */
export function computeDurationMinutes(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  return Math.round(ms / 60000);
}

export function validateEntryTimes(startedAt: Date, endedAt: Date): string | null {
  if (!(endedAt.getTime() > startedAt.getTime())) {
    return 'endedAt must be after startedAt.';
  }
  return null;
}

export function hoursBetween(startedAt: Date, endedAt: Date): number {
  return (endedAt.getTime() - startedAt.getTime()) / 3600000;
}

/** Rate × hours, Decimal-safe (2dp). */
export function laborAmount(hourlyRate: Prisma.Decimal, minutes: number): Prisma.Decimal {
  const hours = new Prisma.Decimal(minutes).dividedBy(60);
  return hourlyRate.mul(hours).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Quantity × unit price, Decimal-safe (2dp). */
export function productLineAmount(quantity: number, unitPrice: number): Prisma.Decimal {
  return new Prisma.Decimal(quantity)
    .mul(new Prisma.Decimal(unitPrice))
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface TimesheetTotalsInput {
  hourlyRate: Prisma.Decimal;
  startedAt: Date;
  endedAt: Date;
  products: TimesheetProductInput[];
}

export interface TimesheetTotals {
  durationMinutes: number;
  laborAmount: Prisma.Decimal;
  productAmounts: Prisma.Decimal[];
  subtotal: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
}

export const DEFAULT_TIMESHEET_TAX_RATE = new Prisma.Decimal('0.05');

export function computeTimesheetTotals(input: TimesheetTotalsInput, taxRate: number): TimesheetTotals {
  const durationMinutes = computeDurationMinutes(input.startedAt, input.endedAt);
  const labor = laborAmount(input.hourlyRate, durationMinutes);
  const productAmounts = input.products.map((p) => productLineAmount(p.quantity, p.unitPrice));

  const subtotal = productAmounts
    .reduce((acc, a) => acc.plus(a), labor)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const rate = new Prisma.Decimal(taxRate);
  const taxAmount = subtotal.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const total = subtotal.plus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    durationMinutes,
    laborAmount: labor,
    productAmounts,
    subtotal,
    taxRate: rate,
    taxAmount,
    total,
  };
}

export function validateTaxRate(taxRate: number): string | null {
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
    return 'Tax rate must be between 0 and 1.';
  }
  return null;
}

export function validateProducts(products: TimesheetProductInput[]): string | null {
  if (products.length === 0) return null;
  for (const p of products) {
    if (!p.name || p.name.trim().length === 0) return 'Product name is required.';
    if (!Number.isFinite(p.quantity) || p.quantity <= 0) return 'Product quantity must be positive.';
    if (!Number.isFinite(p.unitPrice) || p.unitPrice < 0) return 'Product unit price cannot be negative.';
  }
  return null;
}