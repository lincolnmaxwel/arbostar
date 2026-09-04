import { requireUserScope, UnauthorizedError } from '@/lib/userScope';
import { isFeatureEnabled } from '@/lib/features';
import { TimesheetClient } from '@/components/TimesheetClient';
import styles from './timesheet.module.css';

export const dynamic = 'force-dynamic';

export default async function TimesheetPage() {
  let scope;
  try {
    scope = await requireUserScope();
  } catch (err) {
    if (err instanceof UnauthorizedError) return null;
    throw err;
  }

  if (!(await isFeatureEnabled(scope.ownerUserId, 'timesheet'))) {
    return (
      <div>
        <div className={styles.header}>
          <h1 className={styles.title}>Timesheet</h1>
        </div>
        <p className={styles.featureDisabled}>
          Timesheet is not enabled for your account. Ask an administrator to enable it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Timesheet</h1>
      </div>
      <TimesheetClient />
    </div>
  );
}