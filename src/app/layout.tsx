import './globals.css';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { SyncLoopStarter } from '@/components/SyncLoopStarter';
import { Header } from '@/components/Header';

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
        <Header />
        <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '24px 16px' }}>
          {children}
        </main>
        <ServiceWorkerRegistration />
        <SyncLoopStarter />
      </body>
    </html>
  );
}
