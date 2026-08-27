'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchCustomers, upsertCustomer } from '@/lib/data';
import { formatTaka } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { Customer } from '@/types/db';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', village: '', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setCustomers(await fetchCustomers()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }
  useEffect(() => { void load(); }, []);

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('নাম দিন');
    setBusy(true);
    try {
      await upsertCustomer(form);
      setForm({ name: '', phone: '', village: '', note: '' });
      setShowAdd(false);
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
          <div><label className="label">নাম *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">মোবাইল নম্বর</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="label">গ্রাম / ঠিকানা</label>
            <input className="input" value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} /></div>
          <div><label className="label">নোট</label>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
          {err && <p className="col-span-full rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
          <button className="btn-primary col-span-full" disabled={busy}>{busy ? L.common.loading : L.common.save}</button>
        </form>
      )}

      <input className="input" placeholder="নাম / মোবাইল / গ্রাম খুঁজুন…"
        value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="flex gap-2">
        {([['all', 'সব'], ['due', 'বাকিযুক্ত'], ['paid', 'পরিশোধ সম্পন্ন']] as const).map(([k, lbl]) => (
          <button key={k} className={`badge ${filter === k ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter(k)}>{lbl}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map((c) => (
          <div key={c.id} className="card flex items-center justify-between">
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-sm text-gray-500">{c.phone ?? ''} {c.village ? `· ${c.village}` : ''}</div>
            </div>
            <div className="text-right">
              {c.current_due_paisa > 0 ? (
                <span className="text-lg font-bold text-alert">{formatTaka(c.current_due_paisa)}</span>
              ) : (
                <span className="badge-normal">পরিশোধ সম্পন্ন</span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-400">কোনো পাওনাদার নেই</p>}
      </div>
    </div>
  );
}
