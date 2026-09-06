import { redirect } from 'next/navigation';
import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { ServiceCatalogClient } from '@/components/ServiceCatalogClient';
import styles from './services.module.css';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/login');
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return (
      <div className={styles.page}>
        <p className={styles.featureDisabled}>This feature is not enabled for your account.</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Services</h1>
      </div>
      <ServiceCatalogClient />
    </div>
  );
}
