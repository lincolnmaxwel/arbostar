import { prisma } from '@/lib/db';

export interface CatalogCandidate {
  name: string;
  unitPrice: number;
  billingType?: 'quantity' | 'hourly';
  unit?: string | null;
}

/**
 * Products typed straight into a timesheet entry also become Services (the
 * catalog behind /services), the same way a client added from the timesheet
 * shows up in /clients. A row only counts when the form said how it is billed
 * (`billingType`); a name the user already has (case-insensitive) is left alone,
 * so existing prices are never overwritten. Best effort: the entry itself is
 * already saved, so a failure here is logged and ignored.
 */
export async function addProductsToCatalog(userId: string, products: CatalogCandidate[]): Promise<number> {
  try {
    const seen = new Set<string>();
    let created = 0;
    for (const p of products) {
      const name = p.name.trim();
      const key = name.toLowerCase();
      if (!name || !p.billingType || seen.has(key)) continue;
      seen.add(key);
      const exists = await prisma.serviceCatalogItem.findFirst({
        where: { userId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (exists) continue;
      await prisma.serviceCatalogItem.create({
        data: {
          userId,
          name,
          defaultPrice: p.unitPrice,
          billingType: p.billingType,
          unit: p.billingType === 'hourly' ? null : p.unit?.trim().slice(0, 20) || null,
        },
      });
      created++;
    }
    return created;
  } catch (err) {
    console.error('[catalogSync] could not add products to the services catalog', err);
    return 0;
  }
}
