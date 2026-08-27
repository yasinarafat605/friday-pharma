'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchRecentSales, fetchSaleItems, createSaleReturn,
  fetchRecentReturns, cancelSaleReturn,
  type SaleSummary, type SaleItemRow, type SaleReturnRow,
} from '@/lib/data';
import { CancelButton, StatusBadge } from '@/components/CancelButton';
import { formatTaka, takaToPaisa, toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';

interface ReturnLine {
  sale_item_id: string;
  batch_id: string;
  name: string;
  sold: number;
  unit_price_paisa: number;
  qty: number;
  restock: boolean;
}

export default function SaleReturnPage() {
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [saleId, setSaleId] = useState('');
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState('');
  const [refundTaka, setRefundTaka] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [returns, setReturns] = useState<SaleReturnRow[]>([]);

  const loadReturns = useCallback(async () => {
    setReturns(await fetchRecentReturns(30));
  }, []);
  useEffect(() => { void loadReturns(); }, [loadReturns]);

  useEffect(() => {
    (async () => {
      try { setSales(await fetchRecentSales()); }
      catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
    })();
  }, []);

  async function onSelectSale(id: string) {
    setSaleId(id); setLines([]); setMsg(''); setErr('');
    if (!id) return;
    try {
      const items: SaleItemRow[] = await fetchSaleItems(id);
      setLines(items.map((it) => ({
        sale_item_id: it.id,
        batch_id: it.batch_id,
        name: it.medicine_name ?? 'ওষুধ',
        sold: it.qty,
        unit_price_paisa: it.unit_price_paisa,
        qty: 0,
        restock: true,
      })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'আইটেম লোড ব্যর্থ');
    }
  }

  function update(idx: number, patch: Partial<ReturnLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const suggestedRefund = lines.reduce((a, l) => a + Math.round(l.unit_price_paisa * l.qty), 0);

  async function submit() {
    setErr(''); setMsg('');
    const items = lines.filter((l) => l.qty > 0);
    if (items.length === 0) return setErr('অন্তত একটি ওষুধের রিটার্ন পরিমাণ দিন');
    for (const l of items) {
      if (l.qty > l.sold) return setErr(`${l.name}: রিটার্ন পরিমাণ বিক্রীত (${toBanglaDigits(l.sold)}) থেকে বেশি`);
    }
    if (!reason.trim()) return setErr('রিটার্নের কারণ দিন');
    setBusy(true);
    try {
      const res = await createSaleReturn({
        sale_id: saleId,
        reason,
        refund_paisa: refundTaka === '' ? suggestedRefund : takaToPaisa(refundTaka),
        items: items.map((l) => ({
          sale_item_id: l.sale_item_id, batch_id: l.batch_id, qty: l.qty, restock: l.restock,
        })),
      });
      const queued = (res as { queued?: boolean })?.queued;
      setMsg(queued ? 'রিটার্ন সংরক্ষিত (অফলাইন) — সিঙ্ক অপেক্ষমাণ' : 'রিটার্ন সম্পন্ন হয়েছে');
      setLines([]); setSaleId(''); setReason(''); setRefundTaka('');
      setSales(await fetchRecentSales());
      await loadReturns();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'রিটার্ন ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.saleReturn}</h1>

      <div className="card space-y-4">
        <div>
          <label className="label">বিক্রয় নির্বাচন</label>
          <select className="input" value={saleId} onChange={(e) => onSelectSale(e.target.value)}>
            <option value="">— সাম্প্রতিক বিক্রয় থেকে বাছুন —</option>
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.txn_no} · {new Date(s.sale_date).toLocaleDateString('bn-BD')} · {formatTaka(s.total_paisa)}
              </option>
            ))}
          </select>
        </div>

        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold text-brand-dark">রিটার্ন আইটেম</p>
            {lines.map((l, i) => (
              <div key={l.sale_item_id} className="rounded-xl border border-gray-100 p-3">
                <div className="mb-2 flex justify-between">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-sm text-gray-500">
                    বিক্রীত {toBanglaDigits(l.sold)} · {formatTaka(l.unit_price_paisa)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="label">রিটার্ন পরিমাণ</label>
                    <input className="input py-2" type="number" min={0} max={l.sold} value={l.qty}
                      onChange={(e) => update(i, { qty: Math.max(0, Math.min(l.sold, Number(e.target.value))) })} />
                  </div>
                  <label className="mt-5 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={l.restock}
                      onChange={(e) => update(i, { restock: e.target.checked })} />
                    স্টকে ফেরত
                  </label>
                </div>
                {!l.restock && (
                  <p className="mt-1 text-xs text-alert">নষ্ট/মেয়াদোত্তীর্ণ/খোলা — স্টকে ফেরত যাবে না</p>
                )}
              </div>
            ))}

            <div>
              <label className="label">কারণ *</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="যেমন: ভুল ওষুধ, রোগীর প্রয়োজন নেই…" />
            </div>
            <div>
              <label className="label">ফেরতযোগ্য টাকা (৳) — খালি রাখলে {formatTaka(suggestedRefund)}</label>
              <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={refundTaka}
                onChange={(e) => setRefundTaka(e.target.value)} />
            </div>

            {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
            {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

            <button className="btn-primary w-full" disabled={busy} onClick={submit}>
              {busy ? L.common.loading : 'রিটার্ন সম্পন্ন করুন'}
            </button>
          </div>
        )}

        {err && lines.length === 0 && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && lines.length === 0 && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">সাম্প্রতিক রিটার্ন</h2>
        <p className="text-xs text-gray-500">
          রিটার্ন বাতিল করলে ফেরত আসা স্টক আবার কমবে এবং বাকির সমন্বয় উল্টে যাবে।
        </p>
        {returns.length === 0 && <p className="text-gray-400">কোনো রিটার্ন নেই</p>}
        <ul className="space-y-2">
          {returns.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 rounded-xl px-3 py-2 ${
              r.status === 'cancelled' ? 'bg-gray-100' : 'bg-gray-50'}`}>
              <div className="flex-1">
                <p className="font-semibold">{r.txn_no} <StatusBadge status={r.status} /></p>
                <p className="text-xs text-gray-500">
                  {toBanglaDigits(r.return_date)} · {toBanglaDigits(r.item_count)} আইটেম · {r.reason}
                </p>
                {r.cancelled_reason && (
                  <p className="text-xs text-danger">বাতিলের কারণ: {r.cancelled_reason}</p>
                )}
              </div>
              <span className="font-bold text-danger">{formatTaka(r.refund_paisa)}</span>
              {r.status !== 'cancelled' && (
                <CancelButton
                  confirmText={`${r.txn_no} বিক্রয়ের রিটার্ন বাতিল হবে এবং স্টক ও বাকির হিসাব উল্টে যাবে।`}
                  onCancel={(reason) => cancelSaleReturn(r.id, reason)}
                  onError={setErr}
                  onDone={async () => { setMsg('রিটার্ন বাতিল হয়েছে'); await loadReturns(); }}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
