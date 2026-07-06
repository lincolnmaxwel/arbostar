export interface QuoteLineItem {
  price: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateTotals(items: QuoteLineItem[], taxRate: number) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
  const taxAmount = round2(subtotal * taxRate);
  const total = round2(subtotal + taxAmount);
  return { subtotal, taxAmount, total };
}

export function formatMoney(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
