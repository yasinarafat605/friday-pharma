'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCustomers, upsertCustomer, updateCustomer,
  setCustomerOpeningDue, deleteCustomer, fetchCustomerLedger, type LedgerRow,
} from '@/lib/data';
import { formatTaka, takaToPaisa, paisaToTaka, toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { Customer } from '@/types/db';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', village: '', note: '', opening: '' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCustomers(await fetchCustomers()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function flash(text: string) {
    setMsg(text); setErr('');
    window.setTimeout(() => setMsg(''), 4000);
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return customers.filter((c) => {
      const m = !s || c.name.toLowerCase().includes(s) ||
        (c.phone ?? '').includes(s) || (c.village ?? '').toLowerCase().includes(s);
      if (!m) return false;
      if (filter === 'due') return c.current_due_paisa > 0;
      if (filter === 'paid') return c.current_due_paisa <= 0;
      return true;
    });
  }, [customers, q, filter]);

  const totalDue = filtered.reduce((a, c) => a + Math.max(0, c.current_due_paisa), 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('নাম দিন');
    setBusy(true);
    try {
      await upsertCustomer({
        name: form.name,
        phone: form.phone,
        village: form.village,
        note: form.note,
        opening_due_paisa: form.opening.trim() ? takaToPaisa(form.opening) : 0,
      });
      setForm({ name: '', phone: '', village: '', note: '', opening: '' });
      setShowAdd(false);
      flash('পাওনাদার যোগ হয়েছে');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.customers}</h1>
        <button className="btn-primary" onClick={() => setShowAdd((v) => !v)}>+ নতুন পাওনাদার</button>
      </div>

      {showAdd && (
        <form onSubmit={add} className="card grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="নাম *" v={form.name} on={(v) => setForm({ ...form, name: v })} />
          <Field label="ফোন" v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
          <Field label="গ্রাম" v={form.village} on={(v) => setForm({ ...form, village: v })} />
          <Field label="নোট" v={form.note} on={(v) => setForm({ ...form, note: v })} />
          <div className="md:col-span-2">
            <label className="label">পূর্বের বকেয়া (৳) — অ্যাপ শুরুর আগের পুরোনো বাকি</label>
            <input className="input" type="number" inputMode="decimal" step="0.01" min={0}
              placeholder="না থাকলে ফাঁকা রাখুন"
              value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <button className="btn-primary" disabled={busy}>{L.common.save}</button>
          </div>
        </form>
      )}

      <div className="card space-y-3">
        <input className="input" placeholder="নাম, ফোন বা গ্রাম দিয়ে খুঁজুন"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          {([['all', 'সব'], ['due', 'বাকি আছে'], ['paid', 'পরিশোধ সম্পন্ন']] as const).map(([k, lbl]) => (
            <button key={k}
              className={`badge ${filter === k ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}
              onClick={() => setFilter(k)}>
              {lbl}
            </button>
          ))}
          <span className="ml-auto text-sm text-gray-600">
            {toBanglaDigits(filtered.length)} জন · মোট পাওনা {formatTaka(totalDue)}
          </span>
        </div>
      </div>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}

      {filtered.length === 0 && <p className="card text-center text-gray-400">কোনো পাওনাদার নেই</p>}

      <div className="space-y-3">
        {filtered.map((c) => (
          <CustomerCard
            key={c.id}
            customer={c}
            open={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
            onChanged={async (t) => { flash(t); await load(); }}
            onClosed={() => setOpenId(null)}
            onError={setErr}
          />
        ))}
      </div>
    </div>
  );
}

function CustomerCard({
  customer, open, onToggle, onChanged, onClosed, onError,
}: {
  customer: Customer;
  open: boolean;
  onToggle: () => void;
  onChanged: (text: string) => Promise<void>;
  onClosed: () => void;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState({
    name: customer.name,
    phone: customer.phone ?? '',
    village: customer.village ?? '',
    note: customer.note ?? '',
  });
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [busy, setBusy] = useState(false);

  const openingRow = ledger.find((l) => l.entry_type === 'opening');
  const [openingTaka, setOpeningTaka] = useState('');

  const loadLedger = useCallback(async () => {
    const rows = await fetchCustomerLedger(customer.id);
    setLedger(rows);
    const op = rows.find((l) => l.entry_type === 'opening');
    setOpeningTaka(op ? String(paisaToTaka(op.amount_paisa)) : '');
  }, [customer.id]);

  useEffect(() => { if (open) void loadLedger(); }, [open, loadLedger]);

  const hasTxn = ledger.some((l) => l.entry_type !== 'opening');

  async function saveProfile() {
    setBusy(true);
    try {
      await updateCustomer(customer.id, {
        name: form.name,
        phone: form.phone.trim() || null,
        village: form.village.trim() || null,
        note: form.note.trim() || null,
      });
      await onChanged('পাওনাদারের তথ্য সংরক্ষিত হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ');
    } finally { setBusy(false); }
  }

  async function saveOpening() {
    setBusy(true);
    try {
      await setCustomerOpeningDue(customer.id, openingTaka.trim() ? takaToPaisa(openingTaka) : 0);
      await loadLedger();
      await onChanged('পূর্বের বকেয়া হালনাগাদ হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally { setBusy(false); }
  }

  async function remove() {
    const ok = window.confirm(
      `"${customer.name}" মুছে ফেলবেন? এটি ফেরানো যাবে না। শুধু লেনদেনহীন পাওনাদার মোছা যায়।`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCustomer(customer.id);
      onClosed();
      await onChanged('পাওনাদার মুছে ফেলা হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'মুছে ফেলা যায়নি');
    } finally { setBusy(false); }
  }

  const due = customer.current_due_paisa;

  return (
    <div className="card">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onToggle}>
        <div>
          <p className="font-bold text-brand-dark">{customer.name}</p>
          <p className="text-sm text-gray-500">
            {[customer.phone, customer.village].filter(Boolean).join(' · ') || 'তথ্য নেই'}
          </p>
        </div>
        <div className="text-right">
          <p className={`font-bold ${due > 0 ? 'text-alert' : due < 0 ? 'text-brand' : 'text-success'}`}>
            {formatTaka(Math.abs(due))}
          </p>
          <p className="text-xs text-gray-500">
            {due > 0 ? 'বাকি' : due < 0 ? 'অগ্রিম জমা' : 'পরিশোধ সম্পন্ন'}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="নাম *" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <Field label="ফোন" v={form.phone} on={(v) => setForm({ ...form, phone: v })} />
            <Field label="গ্রাম" v={form.village} on={(v) => setForm({ ...form, village: v })} />
            <Field label="নোট" v={form.note} on={(v) => setForm({ ...form, note: v })} />
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy} onClick={saveProfile}>{L.common.save}</button>
            <button className="btn-danger" disabled={busy || hasTxn} onClick={remove}
              title={hasTxn ? 'লেনদেন থাকায় মোছা যাবে না' : ''}>
              মুছে ফেলুন
            </button>
            {hasTxn && <span className="self-center text-xs text-gray-500">লেনদেন থাকায় মোছা যাবে না</span>}
          </div>

          <div className="rounded-xl bg-brand-light p-3">
            <label className="label">পূর্বের বকেয়া (৳)</label>
            <p className="mb-2 text-xs text-gray-600">
              অ্যাপ ব্যবহার শুরুর আগের পুরোনো বাকি এখানে বসান। ০ দিলে এন্ট্রিটি সরে যাবে।
            </p>
            <div className="flex gap-2">
              <input className="input" type="number" inputMode="decimal" step="0.01" min={0}
                value={openingTaka} onChange={(e) => setOpeningTaka(e.target.value)} />
              <button className="btn-outline whitespace-nowrap" disabled={busy} onClick={saveOpening}>
                {openingRow ? 'সংশোধন' : 'যোগ করুন'}
              </button>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-bold text-brand-dark">খতিয়ান</h3>
            {ledger.length === 0 ? (
              <p className="text-sm text-gray-400">কোনো লেনদেন নেই</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2">তারিখ</th>
                      <th className="px-3 py-2">ধরন</th>
                      <th className="px-3 py-2 text-right">পরিমাণ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l) => (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">{toBanglaDigits(l.entry_date.slice(0, 10))}</td>
                        <td className="px-3 py-2">
                          {l.label}
                          {l.note && l.note !== l.label && (
                            <span className="block text-xs text-gray-400">{l.note}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${
                          l.amount_paisa >= 0 ? 'text-alert' : 'text-success'}`}>
                          {l.amount_paisa >= 0 ? '+' : '−'} {formatTaka(Math.abs(l.amount_paisa))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
