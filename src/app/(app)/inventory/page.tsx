'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { fetchStockRows } from '@/lib/data';
import { formatTaka, toBanglaDigits } from '@/lib/money';
import { stockColorClass } from '@/lib/business-rules';
import { L } from '@/lib/i18n/labels';
import type { StockRow } from '@/types/db';

type Filter = 'all' | 'low' | 'out' | 'expiring' | 'expired' | 'syrup' | 'tablet' | 'capsule';

export default function InventoryPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setRows(await fetchStockRows());
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ');
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      const match =
        !s ||
        r.name.toLowerCase().includes(s) ||
        (r.strength ?? '').toLowerCase().includes(s) ||
        (r.generic_name ?? '').toLowerCase().includes(s) ||
        (r.company ?? '').toLowerCase().includes(s) ||
        (r.batch_no ?? '').toLowerCase().includes(s);
      if (!match) return false;
      switch (filter) {
        case 'low': return r.stock_status === 'low';
        case 'out': return r.stock_status === 'out';
        case 'expiring': return ['d30', 'd60', 'd90'].includes(r.expiry_status ?? '');
        case 'expired': return r.expiry_status === 'expired';
        case 'syrup': case 'tablet': case 'capsule': return r.type === filter;
        default: return true;
      }
    });
  }, [rows, q, filter]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'সব' },
    { key: 'low', label: 'কম স্টক' },
    { key: 'out', label: 'স্টক শেষ' },
    { key: 'expiring', label: 'মেয়াদ কাছে' },
    { key: 'expired', label: 'মেয়াদোত্তীর্ণ' },
    { key: 'syrup', label: 'সিরাপ' },
    { key: 'tablet', label: 'ট্যাবলেট' },
    { key: 'capsule', label: 'ক্যাপসুল' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.inventory}</h1>
        <Link href="/medicines" className="btn-outline px-4 py-2 text-sm">
          ✏️ {L.nav.medicines}
        </Link>
      </div>

      <input className="input" placeholder="নাম / জেনেরিক / কোম্পানি / ব্যাচ খুঁজুন…"
        value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key}
            className={`badge ${filter === f.key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}

      <div className="overflow-x-auto rounded-xl2 border border-gray-100 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-light text-brand-dark">
            <tr>
              <th className="p-3">ওষুধ</th>
              <th className="p-3">ধরন</th>
              <th className="p-3">ব্যাচ / মেয়াদ</th>
              <th className="p-3 text-right">স্টক</th>
              <th className="p-3 text-right">ক্রয়</th>
              <th className="p-3 text-right">বিক্রয়</th>
              <th className="p-3">অবস্থা</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => (
              <tr key={r.batch_id}>
                <td className="p-3">
                  <div className="font-semibold">{r.name}{r.strength ? ` ${r.strength}` : ''}</div>
                  <div className="text-xs text-gray-400">{r.company} · {r.generic_name}</div>
                </td>
                <td className="p-3">{L.medicineType[r.type]}</td>
                <td className="p-3">
                  {r.batch_no ?? '—'}
                  <div className={`text-xs ${r.expiry_status === 'expired' ? 'text-danger' : 'text-gray-400'}`}>
                    {r.expiry_date ?? '—'}
                  </div>
                </td>
                <td className="p-3 text-right font-semibold">
                  {toBanglaDigits(r.qty_in_stock)} {L.unit[r.unit]}
                </td>
                <td className="p-3 text-right">{formatTaka(r.purchase_price_paisa)}</td>
                <td className="p-3 text-right">{formatTaka(r.sale_price_paisa)}</td>
                <td className="p-3">
                  <span className={stockColorClass(r.stock_status)}>
                    {L.stockStatus[r.stock_status]}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-400">কোনো ওষুধ পাওয়া যায়নি</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
