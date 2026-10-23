import type { DemoData } from '@/lib/demoData';

export type DemoTab = 'quotes' | 'clients' | 'timesheet' | 'services' | 'invoices' | 'financial';

/** Where the demo is: a tab, and optionally one record opened inside it. */
export interface DemoNav {
  tab: DemoTab;
  /** Quotes tab: a quote id, or 'new' for the builder. Invoices tab: an invoice id. */
  id?: string;
}

export interface DemoScreenProps {
  data: DemoData;
  update: (fn: (d: DemoData) => DemoData) => void;
  today: string;
  nav: DemoNav;
  go: (tab: DemoTab, id?: string) => void;
  toast: (message: string) => void;
}
