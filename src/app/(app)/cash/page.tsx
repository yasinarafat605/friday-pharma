'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchCashSummary, saveCashSession, type CashSummary } from '@/lib/data';
import { formatTaka, takaToPaisa, paisaToTaka } from '@/lib/money';
import { L } from '@/lib/i18n/labels';

export default function CashPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sum, setSum] = useState<CashSummary | null>(null);
  const [openingTaka, setOpeningTaka] = useState('');
  const [actualTaka, setActualTaka] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(''); setMsg('');
    try {
      const s = await fetchCashSummary(date);
      setSum(s);
      setOpeningTaka(String(paisaToTaka(s.opening_paisa)));
      setActualTaka(s.actual_closing_paisa == null ? '' : String(paisaToTaka(s.actual_closing_paisa)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ');
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setErr(''); setMsg('');
    try {
      await saveCashSession({
        date,
        opening_paisa: takaToPaisa(openingTaka || '0'),
        actual_paisa: actualTaka === '' ? null : takaToPaisa(actualTaka),
      });
      setMsg('ক্যাশ সেশন সংরক্ষিত হয়েছে');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.cash}</h1>
        <input className="input w-auto" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

      <div className="card space-y-3">
        <div>
          <label className="label">দিনের শুরুর ক্যাশ (৳)</label>
          <input className="input" type="number" min={0} value={openingTaka}
            onChange={(e) => setOpeningTaka(e.target.value)} />
        </div>

        {sum && (
          <div className="space-y-1 rounded-xl bg-brand-light p-4">
            <Row label="দিনের শুরুর ক্যাশ" value={formatTaka(sum.opening_paisa)} />
            <Row label="+ নগদ বিক্রয়" value={formatTaka(sum.cash_sales_paisa)} tone="success" />
            <Row label="+ নগদে বাকি আদায়" value={formatTaka(sum.collection_paisa)} tone="success" />
            <Row label="− নগদে দেওয়া খরচ" value={formatTaka(sum.expense_paisa)} tone="danger" />
            <Row label="− স্টক ক্রয়ে দেওয়া" value={formatTaka(sum.purchase_paisa)} tone="danger" />
            <div className="my-2 border-t border-brand/20" />
            <Row label="সম্ভাব্য ক্লোজিং ক্যাশ" value={formatTaka(sum.expected_closing_paisa)} bold />
          </div>
        )}

        <div>
          <label className="label">বাস্তব ক্লোজিং ক্যাশ (দিন শেষে গুনে লিখুন) (৳)</label>
          <input className="input" type="number" min={0} value={actualTaka}
            onChange={(e) => setActualTaka(e.target.value)} placeholder="ঐচ্ছিক" />
        </div>

        {sum && sum.difference_paisa != null && (
          <div className={`rounded-xl p-4 text-center font-bold ${
            sum.difference_paisa === 0 ? 'bg-success/10 text-success'
            : 'bg-alert/10 text-alert'}`}>
            ক্যাশ পার্থক্য: {formatTaka(sum.difference_paisa)}
            {sum.difference_paisa === 0 ? ' (মিল আছে)'
              : sum.difference_paisa > 0 ? ' (বেশি আছে)' : ' (কম আছে)'}
          </div>
        )}

        <button className="btn-primary w-full" disabled={busy} onClick={save}>
          {busy ? L.common.loading : 'সংরক্ষণ করুন'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, bold, tone }: {
  label: string; value: string; bold?: boolean; tone?: 'success' | 'danger';
}) {
  const c = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-gray-700';
  return (
    <div className="flex justify-between py-0.5">
      <span className={c}>{label}</span>
      <span className={`${bold ? 'text-lg font-bold text-brand-dark' : c}`}>{value}</span>
    </div>
  );
}
