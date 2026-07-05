import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { SyncLoopStarter } from '@/components/SyncLoopStarter';

export const metadata = {
  title: 'Arbostar Quotes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2c5f2d" />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistration />
        <SyncLoopStarter />
      </body>
    </html>
  );
}
