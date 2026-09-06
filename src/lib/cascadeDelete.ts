import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Cascade deletion helpers for local test/cleanup flows. Each mirrors the
 * schema's referential actions: InvoiceLineItem cascades with Invoice,
 * ServiceCatalogItem/UserFeatureFlag cascade with User, AuditLog.targetUser
 * becomes null — but TimesheetEntry.invoice, Invoice.quote, Client→Invoice,
 * Client→TimesheetEntry, and Quote.createdBy all RESTRICT, so dependents
 * must be deleted explicitly first (a P2003 on a manual test is the sign the
 * order below drifted from the schema).
 */

/**
 * Delete one invoice inside an existing transaction, first detaching every
 * timesheet entry pointing at it (the Restrict on TimesheetEntry.invoice
 * blocks the invoice delete otherwise). InvoiceLineItem rows cascade with
 * the invoice itself. Returns how many entries were deleted alongside.
 */
export async function deleteInvoiceCascade(tx: Prisma.TransactionClient, invoiceId: string) {
  const entries = await tx.timesheetEntry.deleteMany({ where: { invoiceId } });
  await tx.invoice.delete({ where: { id: invoiceId } });
  return entries.count;
}

/**
 * Delete a client and everything attached: timesheet entries, invoices
 * (line items cascade), quotes (items/photos/rounds cascade), then the
 * client row itself. Runs in its own transaction. Returns the deleted quote
 * ids so callers can clean up uploads/quotes/[quoteId] directories, which
 * the database does not touch.
 */
export async function deleteClientCascade(clientId: string): Promise<{ quoteIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.timesheetEntry.deleteMany({ where: { clientId } });
    await tx.invoice.deleteMany({ where: { clientId } });
    const quotes = await tx.quote.findMany({ where: { clientId }, select: { id: true } });
    await tx.quote.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });
    return { quoteIds: quotes.map((q) => q.id) };
  });
}

/**
 * Delete a user and everything they own: timesheet entries, invoices,
 * quotes (by createdById), clients, company profile, then the user row.
 * ServiceCatalogItem and UserFeatureFlag cascade with the User; AuditLog
 * target rows become null. Runs in its own transaction. Returns the deleted
 * quote ids for uploads/quotes/[quoteId] cleanup.
 */
export async function deleteUserCascade(userId: string): Promise<{ quoteIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.timesheetEntry.deleteMany({ where: { userId } });
    await tx.invoice.deleteMany({ where: { userId } });
    const quotes = await tx.quote.findMany({ where: { createdById: userId }, select: { id: true } });
    await tx.quote.deleteMany({ where: { createdById: userId } });
    await tx.client.deleteMany({ where: { userId } });
    await tx.companyProfile.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
    return { quoteIds: quotes.map((q) => q.id) };
  });
}