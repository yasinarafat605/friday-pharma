'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { isUnlocked, lock, verifyPin, PIN_LENGTH } from '@/lib/auth';
import { getSettings } from '@/lib/db/local';
import { backupStatus, type BackupStatus } from '@/lib/business-rules';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import BrandMark from '@/components/BrandMark';

import { useAuth } from '@/lib/supabase/AuthContext';

const NAV = [
  { href: '/dashboard', label: L.nav.dashboard, icon: '🏠' },
  { href: '/sales', label: L.nav.sales, icon: '🧾' },
  { href: '/sales-history', label: L.nav.salesHistory, icon: '📜' },
  { href: '/add-stock', label: L.nav.addStock, icon: '➕' },
  { href: '/inventory', label: L.nav.inventory, icon: '💊' },
  { href: '/medicines', label: L.nav.medicines, icon: '✏️' },
  { href: '/customers', label: L.nav.customers, icon: '👥' },
  { href: '/due-collection', label: L.nav.dueCollection, icon: '💰' },
  { href: '/expenses', label: L.nav.expenses, icon: '🧮' },
  { href: '/cash', label: L.nav.cash, icon: '🪙' },
  { href: '/sale-return', label: L.nav.saleReturn, icon: '↩️' },
  { href: '/stock-adjust', label: L.nav.stockAdjust, icon: '🛠️' },
  { href: '/reports', label: L.nav.reports, icon: '📊' },
  { href: '/backup', label: L.nav.backup, icon: '🔒' },
  { href: '/settings', label: L.nav.settings, icon: '⚙️' },
];

function getRoleBadge(role: string | null): string {
  switch (role) {
    case 'owner': return 'মালিক';
    case 'manager': return 'ম্যানেজার';
    case 'cashier': return 'ক্যাশিয়ার';
    case 'inventory': return 'স্টক কর্মী';
    case 'accountant': return 'হিসাবরক্ষক';
    default: return '';
  }
}

// মোবাইলে নিচের তাড়াতাড়ি-বাটন (thumb-friendly)
const BOTTOM = [
  { href: '/dashboard', label: L.nav.dashboard, icon: '🏠' },
  { href: '/sales', label: L.nav.sales, icon: '🧾' },
  { href: '/add-stock', label: L.nav.addStock, icon: '➕' },
  { href: '/due-collection', label: L.nav.dueCollection, icon: '💰' },
];

/** static export-এ ঠিকানা "/dashboard/" হয়, তাই তুলনার আগে শেষের স্ল্যাশ বাদ দেওয়া হয়। */
function normalizePath(p: string | null): string {
  if (!p) return '/';
  const t = p.replace(/\/+$/, '');
  return t === '' ? '/' : t;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = normalizePath(usePathname());
  const router = useRouter();
  const {
    user, activePharmacyId, activeRole, memberships, selectPharmacy, signOut, configError,
  } = useAuth();

  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoLockMs, setAutoLockMs] = useState(3 * 60_000);
  const [unlockPin, setUnlockPin] = useState('');
  const [lockErr, setLockErr] = useState('');
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupHidden, setBackupHidden] = useState(false);
  // শিরোনামে এই দোকানের নিজের নাম — না দিলে পণ্যের নাম।
  const [shopName, setShopName] = useState(L.appName);

  // auth gate + settings
  useEffect(() => {
    if (!isUnlocked()) {
      router.replace('/login');
      return;
    }
    setReady(true);
    getSettings().then((s) => {
      setAutoLockMs(Math.max(0, s.auto_lock_minutes) * 60_000);
      setBackup(backupStatus(s.last_backup_at, s.backup_reminder_days));
      setShopName(s.pharmacy_name?.trim() || L.appName);
    }).catch(() => {});
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, [router]);

  // auto screen lock (inactivity)
  useEffect(() => {
    if (!ready || autoLockMs === 0) return;
    let timer: number;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), autoLockMs);
    };
    const events = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset));
    reset();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [ready, autoLockMs]);

  const logout = useCallback(async () => {
    lock();
    if (user) {
      await signOut();
    }
    router.replace('/login');
  }, [router, user, signOut]);

  async function tryUnlock(e: React.FormEvent) {
    e.preventDefault();
    setLockErr('');
    try {
      const ok = await verifyPin(unlockPin);
      if (ok) { setLocked(false); setUnlockPin(''); }
      else setLockErr('PIN ভুল');
    } catch (e) {
      setLockErr(e instanceof Error ? e.message : 'ব্যর্থ');
    }
  }

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">{L.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col">
      <header
        className="sticky top-0 z-20 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 text-brand-dark" onClick={() => setMenuOpen((v) => !v)} aria-label="মেনু">
            <span className="text-2xl">☰</span>
            <BrandMark className="h-7 w-auto shrink-0" />
            <span className="text-lg font-bold">{shopName}</span>
          </button>

          {/* একাধিক ফার্মেসিতে থাকলে ড্রপডাউন সুইচার */}
          {memberships.length > 1 && (
            <select
              className="ml-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-brand-dark font-medium"
              value={activePharmacyId || ''}
              onChange={(e) => selectPharmacy(e.target.value)}
              aria-label="দোকান নির্বাচন"
            >
              {memberships.map((m) => (
                <option key={m.pharmacy_id} value={m.pharmacy_id}>
                  {m.pharmacies?.name || m.pharmacy_id.slice(0, 8)} ({getRoleBadge(m.role)})
                </option>
              ))}
            </select>
          )}

          {activeRole && (
            <span className="ml-1 rounded bg-brand/10 px-2 py-0.5 text-xs font-semibold text-brand">
              {getRoleBadge(activeRole)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="badge badge-normal hidden sm:inline">🔒 এই ডিভাইসে নিরাপদ</span>
          <button className="btn-outline px-3 py-1.5 text-xs sm:text-sm" onClick={() => setLocked(true)}>লক</button>
          <button className="btn-outline px-3 py-1.5 text-xs sm:text-sm text-danger border-danger/30" onClick={logout}>লগআউট</button>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className={`${menuOpen ? 'block' : 'hidden'} w-full shrink-0 border-r border-gray-100 bg-white p-3 md:block md:w-60`}>
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = pathname === normalizePath(item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-btn font-medium ${
                      active ? 'bg-brand text-white' : 'text-ink hover:bg-brand-light'}`}>
                    <span className="text-xl">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 p-4 pb-24 md:pb-4">
          {/* ভাঙা deploy — ভেতরের প্রতিটি পর্দাতেই দেখা যাবে */}
          {configError && (
            <div className="mb-4 rounded-xl2 border-2 border-danger bg-danger/10 px-4 py-3">
              <p className="text-sm font-bold text-danger">সার্ভার সেটিংস ভুল — ক্লাউড বন্ধ রাখা হয়েছে</p>
              <p className="mt-1 break-words text-xs text-danger">{configError}</p>
              <p className="mt-1 text-xs text-gray-600">
                অফলাইন কাজ চলবে, কিন্তু কিছুই সার্ভারে যাবে না। যিনি অ্যাপটি বসিয়েছেন তাঁকে দেখান।
              </p>
            </div>
          )}

          {backup?.overdue && !backupHidden && pathname !== '/backup' && (
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl2 border-2 border-alert/40 bg-alert/10 px-4 py-3">
              <span className="text-2xl">💾</span>
              <p className="flex-1 text-sm font-medium text-ink">
                {backup.never
                  ? 'আপনি এখনো কোনো ব্যাকআপ নেননি। ফোন বা ব্রাউজারের ডেটা মুছে গেলে সব হিসাব হারিয়ে যাবে।'
                  : `শেষ ব্যাকআপ ${toBanglaDigits(backup.daysSince ?? 0)} দিন আগে। নতুন ব্যাকআপ নেওয়ার সময় হয়েছে।`}
              </p>
              <Link href="/backup" className="btn-primary px-4 py-2 text-sm" onClick={() => setBackupHidden(true)}>
                এখনই ব্যাকআপ নিন
              </Link>
              <button className="text-sm text-gray-500 underline" onClick={() => setBackupHidden(true)}>
                পরে
              </button>
            </div>
          )}
          {children}
        </main>
      </div>

      {/* মোবাইল bottom nav — বড় বাটন, দ্রুত ব্যবহার */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-gray-200 bg-white md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {BOTTOM.map((item) => {
          const active = pathname === normalizePath(item.href);
          return (
            <Link key={item.href} href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs font-medium ${
                active ? 'text-brand' : 'text-gray-500'}`}>
              <span className="text-2xl leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {locked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-dark/95 p-6">
          <form onSubmit={tryUnlock} className="w-full max-w-xs text-center text-white">
            <BrandMark className="mx-auto mb-4 h-14 w-auto" mono="#FFFFFF" />
            <div className="mb-3 text-4xl">🔒</div>
            <p className="mb-4 text-xl font-bold">স্ক্রিন লক</p>
            <input inputMode="numeric" maxLength={PIN_LENGTH} autoFocus
              className="input mb-3 text-center text-2xl tracking-[0.5em] text-ink"
              value={unlockPin}
              onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
              placeholder={'•'.repeat(PIN_LENGTH)} />
            {lockErr && <p className="mb-2 text-sm text-red-200">{lockErr}</p>}
            <button className="btn-primary w-full bg-white text-brand-dark">খুলুন</button>
            <button type="button" className="mt-3 w-full text-sm text-white/70 underline" onClick={logout}>
              লগআউট করুন
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
