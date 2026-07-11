export type InvoicePaymentStatus = 'pending' | 'paid';

export function getPaymentStatusLabel(status: InvoicePaymentStatus): string {
  return status === 'paid' ? 'Paid' : 'Pending payment';
}
