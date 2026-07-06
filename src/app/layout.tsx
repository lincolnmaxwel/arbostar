import './globals.css';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { SyncLoopStarter } from '@/components/SyncLoopStarter';
import { Header } from '@/components/Header';

export const metadata = {
  title: 'Arbostar Quotes',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2c5f2d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <Providers>
          <Header />
          <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '24px 16px' }}>
            {children}
          </main>
          <ServiceWorkerRegistration />
          <SyncLoopStarter />
        </Providers>
      </body>
    </html>
  );
}
