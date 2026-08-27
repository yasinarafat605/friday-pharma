'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchExpenseCategories, addExpense, fetchExpenses, updateExpense, cancelExpense,
} from '@/lib/data';
import { CancelButton, StatusBadge } from '@/components/CancelButton';
import { formatTaka, takaToPaisa, paisaToTaka, toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { Expense, ExpenseSource } from '@/types/db';

interface Cat { id: string; bn_name: string; name: string }

const SOURCES: ExpenseSource[] = ['cash', 'bkash', 'nagad', 'rocket', 'bank', 'other'];

export default function ExpensesPage() {
  const [cats, setCats] = useState<Cat[]>([]);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ category_id: '', amount: '', date: '', desc: '', source: 'cash' as ExpenseSource });
  const [categoryId, setCategoryId] = useState('');
  const [amountTaka, setAmountTaka] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState('');
  const [source, setSource] = useState<ExpenseSource>('cash');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const loadRecent = useCallback(async () => {
    setRecent(await fetchExpenses(30));
  }, []);

  const loadCats = useCallback(async () => {
    setCats((await fetchExpenseCategories()) as Cat[]);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadCats();
        await loadRecent();
      } catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
    })();
  }, [loadCats, loadRecent]);

  function startEdit(r: Expense) {
    setEditId(r.id);
    setEditForm({
      category_id: r.category_id,
      amount: String(paisaToTaka(r.amount_paisa)),
      date: r.expense_date,
      desc: r.description ?? '',
      source: r.payment_source,
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setErr(''); setMsg('');
    setBusy(true);
    try {
      await updateExpense(editId, {
        category_id: editForm.category_id,
        amount_paisa: takaToPaisa(editForm.amount),
        expense_date: editForm.date,
        description: editForm.desc.trim() || null,
        payment_source: editForm.source,
      });
      setEditId(null);
      setMsg('খরচ সংশোধন হয়েছে');
      await loadRecent();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'সংশোধন ব্যর্থ');
    } finally { setBusy(false); }
  }

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
          <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={amountTaka} onChange={(e) => setAmountTaka(e.target.value)} /></div>
        <div><label className="label">তারিখ</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">উৎস</label>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as ExpenseSource)}>
            {SOURCES.map((s) => <option key={s} value={s}>{L.expenseSource[s] ?? s}</option>)}
          </select></div>
        <div className="md:col-span-2"><label className="label">সংক্ষিপ্ত বিবরণ</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>

        {err && <p className="col-span-full rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="col-span-full rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
        <button className="btn-primary col-span-full" disabled={busy}>{busy ? L.common.loading : 'খরচ যোগ করুন'}</button>
      </form>

      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">সাম্প্রতিক খরচ</h2>
        <p className="text-xs text-gray-500">
          প্রতিটি খরচ সংশোধন বা বাতিল করা যায়। বাতিল করলে রেকর্ডটি থাকবে কিন্তু হিসাবে ধরা হবে না।
        </p>
        {recent.length === 0 && <p className="text-gray-400">কোনো খরচ নেই</p>}
        <ul className="space-y-2">
          {recent.map((r) => (
            <li key={r.id} className={`rounded-xl px-3 py-2 ${
              r.status === 'cancelled' ? 'bg-gray-100' : 'bg-gray-50'}`}>
              {editId === r.id ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div><label className="label">ক্যাটাগরি</label>
                    <select className="input" value={editForm.category_id}
                      onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.bn_name}</option>)}
                    </select></div>
                  <div><label className="label">পরিমাণ (৳)</label>
                    <input className="input" type="number" inputMode="decimal" step="0.01" min={0}
                      value={editForm.amount}
                      onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></div>
                  <div><label className="label">তারিখ</label>
                    <input className="input" type="date" value={editForm.date}
                      onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} /></div>
                  <div><label className="label">উৎস</label>
                    <select className="input" value={editForm.source}
                      onChange={(e) => setEditForm({ ...editForm, source: e.target.value as ExpenseSource })}>
                      {SOURCES.map((x) => <option key={x} value={x}>{L.expenseSource[x] ?? x}</option>)}
                    </select></div>
                  <div className="md:col-span-2"><label className="label">বিবরণ</label>
                    <input className="input" value={editForm.desc}
                      onChange={(e) => setEditForm({ ...editForm, desc: e.target.value })} /></div>
                  <div className="flex gap-3 md:col-span-2">
                    <button className="btn-primary" disabled={busy} onClick={saveEdit}>{L.common.save}</button>
                    <button className="btn-outline" onClick={() => setEditId(null)}>{L.common.cancel}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">
                      {catName(r.category_id)} <StatusBadge status={r.status} />
                    </p>
                    <p className="text-xs text-gray-500">
                      {toBanglaDigits(r.expense_date)} · {L.expenseSource[r.payment_source] ?? r.payment_source}
                      {r.description ? ` · ${r.description}` : ''}
                    </p>
                  </div>
                  <span className="font-semibold text-danger">{formatTaka(r.amount_paisa)}</span>
                  {r.status !== 'cancelled' && (
                    <>
                      <button className="rounded-lg border border-brand px-3 py-1 text-sm font-semibold text-brand"
                        onClick={() => startEdit(r)}>
                        {L.common.edit}
                      </button>
                      <CancelButton
                        confirmText={`${formatTaka(r.amount_paisa)} খরচ বাতিল হবে এবং হিসাব থেকে বাদ যাবে।`}
                        onCancel={(reason) => cancelExpense(r.id, reason)}
                        onError={setErr}
                        onDone={async () => { setMsg('খরচ বাতিল হয়েছে'); await loadRecent(); }}
                      />
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
