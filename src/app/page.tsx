'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { L } from '@/lib/i18n/labels';

// Static export-এ server redirect চলে না — client-side redirect।
// /dashboard-এ পাঠায়; unlock না থাকলে AppShell /login-এ নেবে।
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-light text-brand-dark">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white">
          FP
        </div>
        <p className="font-bold">{L.appName}</p>
        <p className="text-sm text-gray-500">{L.common.loading}</p>
      </div>
    </main>
  );
}
