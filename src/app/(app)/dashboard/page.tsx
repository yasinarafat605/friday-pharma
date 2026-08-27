'use client';

import { useEffect, useState } from 'react';
import { StatCard } from '@/components/StatCard';
import { fetchDashboardStats, fetchStockRows, type DashboardStats } from '@/lib/data';
import { formatTaka, toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { StockRow } from '@/types/db';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, r] = await Promise.all([fetchDashboardStats(), fetchStockRows()]);
        setStats(s);
        setRows(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'ডেটা লোড ব্যর্থ');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lowStock = rows.filter((r) => r.stock_status === 'low' || r.stock_status === 'out');
  const expiring = rows.filter((r) => ['d30', 'd60', 'd90'].includes(r.expiry_status ?? ''));
  const expired = rows.filter((r) => r.expiry_status === 'expired');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.dashboard}</h1>
        <p className="text-gray-500">{L.tagline}</p>
      </div>

      {loading && <p className="text-gray-500">{L.common.loading}</p>}
      {error && (
        <div className="card border-danger/30 bg-danger/5 text-danger">
          {error} — Supabase সংযোগ ও `.env.local` যাচাই করুন।
        </div>
      )}

      {stats && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="আজকের মোট বিক্রয়" valuePaisa={stats.todaySalesPaisa} />
            <StatCard label="আজকের নগদ বিক্রয়" valuePaisa={stats.todayCashPaisa} tone="success" />
            <StatCard label="আজকের বাকিতে বিক্রয়" valuePaisa={stats.todayDuePaisa} tone="alert" />
            <StatCard label="আজকে বাকি আদায়" valuePaisa={stats.todayCollectionPaisa} tone="success" />
            <StatCard label="আজকের মোট খরচ" valuePaisa={stats.todayExpensePaisa} tone="danger" />
            <StatCard label="আজকের আনুমানিক লাভ" valuePaisa={stats.todayProfitPaisa} tone="brand" />
            <StatCard label="বর্তমান মোট পাওনা" valuePaisa={stats.totalDuePaisa} tone="alert" />
            <StatCard label="বর্তমান স্টকের মূল্য" valuePaisa={stats.stockValuePaisa} />
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <AlertList
              title="কম স্টকের ওষুধ"
              tone="alert"
              empty="সব স্টক স্বাভাবিক"
              items={lowStock.map(
                (r) => `${r.name} — মাত্র ${toBanglaDigits(r.qty_in_stock)} ${L.unit[r.unit]} বাকি`,
              )}
            />
            <AlertList
              title="শিগগির মেয়াদ শেষ হবে"
              tone="alert"
              empty="কোনো ওষুধ নেই"
              items={expiring.map((r) => `${r.name} — মেয়াদ ${r.expiry_date}`)}
            />
            <AlertList
              title="মেয়াদ শেষ হয়ে গেছে"
              tone="danger"
              empty="কোনো expired ওষুধ নেই"
              items={expired.map((r) => `${r.name} — ${r.expiry_date} (বিক্রি নিষিদ্ধ)`)}
            />
          </section>
        </>
      )}
    </div>
  );
}

function AlertList({
  title, items, tone, empty,
}: {
  title: string;
  items: string[];
  tone: 'alert' | 'danger';
  empty: string;
}) {
  const border = tone === 'danger' ? 'border-danger/30' : 'border-alert/30';
  const head = tone === 'danger' ? 'text-danger' : 'text-alert';
  return (
    <div className={`card ${border}`}>
      <h2 className={`mb-2 font-bold ${head}`}>
        {title} {items.length > 0 && `(${toBanglaDigits(items.length)})`}
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.slice(0, 8).map((t, i) => (
            <li key={i} className="rounded bg-gray-50 px-3 py-2">{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
