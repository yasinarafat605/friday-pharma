'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSalesHistory, fetchSaleItems, cancelSale,
  type SaleHistoryRow, type SaleItemRow,
} from '@/lib/data';
import { CancelButton, StatusBadge } from '@/components/CancelButton';
import { formatTaka, toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';

export default function SalesHistoryPage() {
  const [rows, setRows] = useState<SaleHistoryRow[]>([]);
  const [q, setQ] = useState('');
  const [showCancelled, setShowCancelled] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<SaleItemRow[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setRows(await fetchSalesHistory(100, true)); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    try { setItems(await fetchSaleItems(id)); }
    catch { setItems([]); }
  }

  function flash(t: string) {
    setMsg(t); setErr('');
    window.setTimeout(() => setMsg(''), 4000);
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showCancelled && r.status === 'cancelled') return false;
      if (!s) return true;
      return r.txn_no.toLowerCase().includes(s)
        || (r.customer_name ?? '').toLowerCase().includes(s);
    });
  }, [rows, q, showCancelled]);

  const activeTotal = filtered
    .filter((r) => r.status !== 'cancelled')
    .reduce((a, r) => a + r.total_paisa, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.salesHistory}</h1>
        <p className="text-sm text-gray-500">
          ভুল বিক্রয় বাতিল করুন। বাতিল করলে স্টক ফেরত যায়, বাকি ও ক্যাশ ঠিক হয়ে যায়, রেকর্ডটি বাতিল চিহ্ন নিয়ে থাকে।
        </p>
      </div>

      <div className="card space-y-3">
        <input className="input" placeholder="বিক্রয় নম্বর বা পাওনাদারের নাম"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)} />
            বাতিল বিক্রয়ও দেখান
          </label>
          <span className="ml-auto text-sm text-gray-600">
            {toBanglaDigits(filtered.length)} টি · সক্রিয় মোট {formatTaka(activeTotal)}
          </span>
        </div>
      </div>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}

      {filtered.length === 0 && <p className="card text-center text-gray-400">কোনো বিক্রয় নেই</p>}

      <div className="space-y-3">
        {filtered.map((r) => (
          <div key={r.id} className={`card ${r.status === 'cancelled' ? 'bg-gray-50' : ''}`}>
            <div className="flex flex-wrap items-center gap-3">
              <button className="flex-1 text-left" onClick={() => toggle(r.id)}>
                <p className="font-bold text-brand-dark">
                  {r.txn_no} <StatusBadge status={r.status} />
                </p>
                <p className="text-sm text-gray-500">
                  {toBanglaDigits(r.sale_date.slice(0, 10))} · {L.paymentType[r.payment_type]}
                  {r.customer_name ? ` · ${r.customer_name}` : ''}
                </p>
                {r.cancelled_reason && (
                  <p className="text-xs text-danger">বাতিলের কারণ: {r.cancelled_reason}</p>
                )}
              </button>
              <div className="text-right">
                <p className="font-bold">{formatTaka(r.total_paisa)}</p>
                {r.due_paisa > 0 && (
                  <p className="text-xs text-alert">বাকি {formatTaka(r.due_paisa)}</p>
                )}
              </div>
              {r.status !== 'cancelled' && (
                <CancelButton
                  confirmText={`${r.txn_no} বিক্রয় বাতিল হবে। স্টক ফেরত যাবে এবং বাকির হিসাব ঠিক হবে।`}
                  onCancel={(reason) => cancelSale(r.id, reason)}
                  onError={setErr}
                  onDone={async () => { flash('বিক্রয় বাতিল হয়েছে'); await load(); }}
                />
              )}
            </div>

            {openId === r.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                {items.length === 0 ? (
                  <p className="text-sm text-gray-400">আইটেম নেই</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {items.map((it) => (
                      <li key={it.id} className="flex justify-between rounded bg-gray-50 px-3 py-2">
                        <span>{it.medicine_name ?? 'ওষুধ'} × {toBanglaDigits(it.qty)}</span>
                        <span>{formatTaka(it.line_total_paisa)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {r.discount_paisa > 0 && (
                  <p className="mt-2 text-sm text-gray-600">ছাড়: {formatTaka(r.discount_paisa)}</p>
                )}
                <p className="text-sm text-gray-600">
                  নগদ: {formatTaka(r.cash_paid_paisa)} · বাকি: {formatTaka(r.due_paisa)}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
