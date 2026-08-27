'use client';

import { useEffect, useState } from 'react';
import { fetchExpenseCategories, addExpense, fetchRecentExpenses } from '@/lib/data';
import { formatTaka, takaToPaisa } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { ExpenseSource } from '@/types/db';

interface Cat { id: string; bn_name: string; name: string }
interface ExpRow { id: string; expense_date: string; amount_paisa: number; description: string | null; category_id: string }

const SOURCES: ExpenseSource[] = ['cash', 'bkash', 'nagad', 'rocket', 'bank', 'other'];

export default function ExpensesPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [recent, setRecent] = useState<ExpRow[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [amountTaka, setAmountTaka] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState('');
  const [source, setSource] = useState<ExpenseSource>('cash');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadRecent() {
    setRecent((await fetchRecentExpenses(10)) as ExpRow[]);
  }

  useEffect(() => {
    (async () => {
      try {
        setCats((await fetchExpenseCategories()) as Cat[]);
        await loadRecent();
      } catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
    })();
  }, []);

  const catName = (id: string) => cats.find((c) => c.id === id)?.bn_name ?? '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!categoryId) return setErr('ক্যাটাগরি নির্বাচন করুন');
    const amount = takaToPaisa(amountTaka);
    if (amount <= 0) return setErr('পরিমাণ ০-এর বেশি দিন');
    setBusy(true);
    try {
      await addExpense({ category_id: categoryId, amount_paisa: amount, expense_date: date, description: desc || null, payment_source: source });
      setMsg(`খরচ যোগ হয়েছে — ${formatTaka(amount)}`);
      setAmountTaka(''); setDesc('');
      await loadRecent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.expenses}</h1>

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-2">
        <div><label className="label">ক্যাটাগরি</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— নির্বাচন করুন —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.bn_name}</option>)}
          </select></div>
        <div><label className="label">পরিমাণ (৳)</label>
          <input className="input" type="number" min={0} value={amountTaka} onChange={(e) => setAmountTaka(e.target.value)} /></div>
        <div><label className="label">তারিখ</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">উৎস</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as ExpenseSource)}>
            {SOURCES.map((s) => <option key={s} value={s}>{L.paymentMethod[s] ?? s}</option>)}
          </select></div>
        <div className="md:col-span-2"><label className="label">সংক্ষিপ্ত বিবরণ</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>

        {err && <p className="col-span-full rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="col-span-full rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
        <button className="btn-primary col-span-full" disabled={busy}>{busy ? L.common.loading : 'খরচ যোগ করুন'}</button>
      </form>

      <div className="card">
        <h2 className="mb-2 font-bold text-brand-dark">সাম্প্রতিক খরচ</h2>
        <ul className="divide-y divide-gray-100">
          {recent.map((r) => (
            <li key={r.id} className="flex justify-between py-2">
              <span>{catName(r.category_id)} <span className="text-xs text-gray-400">{r.expense_date}</span></span>
              <span className="font-semibold text-danger">{formatTaka(r.amount_paisa)}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="py-2 text-gray-400">কোনো খরচ নেই</li>}
        </ul>
      </div>
    </div>
  );
}
