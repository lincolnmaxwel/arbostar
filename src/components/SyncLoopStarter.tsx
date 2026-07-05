'use client';

import { useEffect } from 'react';
import { startSyncLoop } from '@/lib/syncWorker';

export function SyncLoopStarter() {
  useEffect(() => {
    const stop = startSyncLoop();
    return stop;
  }, []);

  return null;
}
