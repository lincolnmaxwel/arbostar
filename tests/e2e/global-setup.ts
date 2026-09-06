import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

// Idempotent seed for the per-user isolation E2E spec: two staff users
// (one with all optional features, one with none), a confirmed client +
// scheduled quote + open timesheet entry for user A, and a per-user profile.
// Runs once before the production server starts.

export const E2E_STAFF_A = 'e2e-staff-a@example.com';
export const E2E_STAFF_B = 'e2e-staff-b@example.com';
export const E2E_CLIENT_EMAIL = 'e2e-client@example.com';
export const E2E_DRAFT_ID = 'e2e-draft-0000-0000-0000-000000000001';
export const E2E_ENTRY_ID = 'e2e-entry-0000-0000-0000-000000000001';
export const E2E_PASSWORD = 'changeme123';

export default async function globalSetup() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);

    const staffA = await prisma.user.upsert({
      where: { email: E2E_STAFF_A },
      update: { name: 'E2E Staff A', hourlyRate: 75 },
      create: {
        name: 'E2E Staff A',
        email: E2E_STAFF_A,
        passwordHash,
        role: 'staff',
        status: 'active',
        hourlyRate: 75,
      },
    });
    const staffB = await prisma.user.upsert({
      where: { email: E2E_STAFF_B },
      update: { name: 'E2E Staff B', hourlyRate: 0 },
      create: {
        name: 'E2E Staff B',
        email: E2E_STAFF_B,
        passwordHash,
        role: 'staff',
        status: 'active',
        hourlyRate: 0,
      },
    });

    for (const feature of ['invoices', 'timesheet', 'clients_crm', 'quotes'] as const) {
      await prisma.userFeatureFlag.upsert({
        where: { userId_feature: { userId: staffA.id, feature } },
        update: { enabled: true },
        create: { userId: staffA.id, feature, enabled: true },
      });
      await prisma.userFeatureFlag.upsert({
        where: { userId_feature: { userId: staffB.id, feature } },
        update: { enabled: false },
        create: { userId: staffB.id, feature, enabled: false },
      });
    }

    // Reset any data accumulated by previous E2E runs so the spec is
    // deterministic: entries (except the fixed seed), timesheet invoices,
    // and non-seed quotes for user A.
    await prisma.timesheetProduct.deleteMany({ where: { timesheetEntry: { userId: staffA.id } } });
    await prisma.timesheetEntry.deleteMany({ where: { userId: staffA.id } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { userId: staffA.id } } });
    await prisma.invoice.deleteMany({ where: { userId: staffA.id } });
    await prisma.quote.deleteMany({ where: { createdById: staffA.id, draftId: { not: E2E_DRAFT_ID } } });

    await prisma.companyProfile.upsert({
      where: { userId: staffA.id },
      update: { name: 'E2E Tree Service' },
      create: { userId: staffA.id, name: 'E2E Tree Service' },
    });

    const client = await prisma.client.upsert({
      where: { userId_email: { userId: staffA.id, email: E2E_CLIENT_EMAIL } },
      update: { name: 'E2E Client' },
      create: { userId: staffA.id, name: 'E2E Client', email: E2E_CLIENT_EMAIL },
    });

    await prisma.quote.upsert({
      where: { draftId: E2E_DRAFT_ID },
      update: { clientId: client.id, createdById: staffA.id, status: 'scheduled' },
      create: {
        draftId: E2E_DRAFT_ID,
        clientId: client.id,
        createdById: staffA.id,
        status: 'scheduled',
        subtotal: 100,
        taxRate: 0.05,
        taxAmount: 5,
        total: 105,
        items: { create: [{ localItemId: randomUUID(), title: 'E2E service', price: 100, sortOrder: 0 }] },
      },
    });

    await prisma.timesheetEntry.upsert({
      where: { id: E2E_ENTRY_ID },
      update: { status: 'open', invoiceId: null, hourlyRate: 75, durationMinutes: 240 },
      create: {
        id: E2E_ENTRY_ID,
        userId: staffA.id,
        clientId: client.id,
        workDate: new Date('2026-09-01T12:00:00.000Z'),
        startedAt: new Date('2026-09-01T13:00:00.000Z'),
        endedAt: new Date('2026-09-01T17:00:00.000Z'),
        durationMinutes: 240,
        hourlyRate: 75,
        description: 'E2E seeded work description',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}