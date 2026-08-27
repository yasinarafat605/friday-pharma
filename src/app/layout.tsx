import type { Metadata, Viewport } from 'next';
import { Noto_Sans_Bengali } from 'next/font/google';
import './globals.css';
import PWARegister from '@/components/PWARegister';

const bangla = Noto_Sans_Bengali({
  subsets: ['bengali'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-bangla',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'আশ শিফা ফার্মেসী',
  description: 'সহজ হিসাব, নিরাপদ ব্যবস্থাপনা',
  manifest: '/manifest.json',
  applicationName: 'আশ শিফা ফার্মেসী',
};

export const viewport: Viewport = {
  themeColor: '#0f7a4d',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" className={bangla.variable}>
      <body className="min-h-screen font-bangla antialiased">
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
