import { DemoApp } from '@/components/demo/DemoApp';

export const metadata = {
  title: 'MyJobbs demo',
  description: 'Try MyJobbs with sample data: quotes, timesheet, invoices and more. Nothing is saved.',
};

export default function DemoPage() {
  return <DemoApp />;
}
