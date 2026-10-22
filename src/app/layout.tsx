import './globals.css';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { SyncLoopStarter } from '@/components/SyncLoopStarter';
import { Header } from '@/components/Header';
import { AppMain } from '@/components/AppMain';
import { ProductTour } from '@/components/ProductTour';

export const metadata = {
  title: 'MyJobbs',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#075bff',
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
          <AppMain>{children}</AppMain>
          <ServiceWorkerRegistration />
          <SyncLoopStarter />
          <ProductTour />
        </Providers>
      </body>
    </html>
  );
}
