'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchStockRows, adjustStock } from '@/lib/data';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { StockRow, AdjustmentReason } from '@/types/db';

const REASONS: AdjustmentReason[] = ['expired', 'damaged', 'broken', 'lost', 'personal_use', 'wrong_entry', 'other'];

export default function StockAdjustPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [q, setQ] = useState('');
  const [batchId, setBatchId] = useState('');
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('damaged');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setRows(await fetchStockRows()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows.slice(0, 20);
    return rows.filter((r) =>
      r.name.toLowerCase().includes(s) ||
      (r.batch_no ?? '').toLowerCase().includes(s) ||
      (r.company ?? '').toLowerCase().includes(s),
    ).slice(0, 20);
  }, [rows, q]);

  const selected = rows.find((r) => r.batch_id === batchId);

  async function submit() {
    setErr(''); setMsg('');
    if (!batchId) return setErr('ব্যাচ নির্বাচন করুন');
    const n = Number(qty);
    if (!n || n <= 0) return setErr('পরিমাণ ০-এর বেশি দিন');
    if (direction === 'down' && selected && n > selected.qty_in_stock) {
      return setErr(`স্টকে আছে মাত্র ${toBanglaDigits(selected.qty_in_stock)} — এর বেশি কমানো যাবে না`);
    }
    setBusy(true);
    try {
      const delta = direction === 'down' ? -n : n;
      const res = await adjustStock({ batch_id: batchId, qty: delta, reason, note: note || null });
      const queued = (res as { queued?: boolean })?.queued;
      setMsg(queued ? 'সমন্বয় সংরক্ষিত (অফলাইন)' : 'স্টক সমন্বয় সম্পন্ন হয়েছে');
      setQty(''); setNote(''); setBatchId('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'সমন্বয় ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.stockAdjust}</h1>
      <p className="text-sm text-gray-500">নষ্ট, মেয়াদোত্তীর্ণ, হারানো বা ভুল এন্ট্রির স্টক ঠিক করুন। কারণ বাধ্যতামূলক; প্রতিটি সমন্বয়ের audit history থাকে।</p>

      <div className="card space-y-4">
        <div>
          <label className="label">ব্যাচ খুঁজুন</label>
          <input className="input" placeholder="ওষুধ / ব্যাচ / কোম্পানি…" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>

        <div>
          <label className="label">ব্যাচ নির্বাচন</label>
          <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">— নির্বাচন করুন —</option>
            {filtered.map((r) => (
              <option key={r.batch_id} value={r.batch_id}>
                {r.name} · ব্যাচ {r.batch_no ?? '—'} · স্টক {toBanglaDigits(r.qty_in_stock)} {L.unit[r.unit]}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="rounded-xl bg-brand-light p-3 text-center">
            বর্তমান স্টক: <b>{toBanglaDigits(selected.qty_in_stock)} {L.unit[selected.unit]}</b>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">দিক</label>
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as 'down' | 'up')}>
              <option value="down">কমানো (নষ্ট/হারানো/মেয়াদ)</option>
              <option value="up">বাড়ানো (ভুল এন্ট্রি সংশোধন)</option>
            </select>
          </div>
          <div>
            <label className="label">পরিমাণ</label>
            <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">কারণ *</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
            {REASONS.map((r) => <option key={r} value={r}>{L.adjustmentReason[r]}</option>)}
          </select>
        </div>

        <div>
          <label className="label">নোট</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

        <button className="btn-primary w-full" disabled={busy} onClick={submit}>
          {busy ? L.common.loading : 'সমন্বয় করুন'}
        </button>
      </div>
    </div>
  );
}
