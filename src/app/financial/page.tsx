import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { FinancialClient } from '@/components/FinancialClient';
import styles from './financial.module.css';

export const dynamic = 'force-dynamic';

export default async function FinancialPage() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) return null;
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'invoices'))) {
    return (
      <div>
        <p className={styles.featureDisabled}>This feature is not enabled for your account.</p>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Financial</h1>
      </div>
      <FinancialClient />
    </div>
  );
}
