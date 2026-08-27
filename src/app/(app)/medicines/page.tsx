'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllMedicines, fetchBatchesForMedicine,
  updateMedicine, setMedicineActive, updateBatch,
  deleteMedicine, deleteBatch,
} from '@/lib/data';
import { formatTaka, takaToPaisa, paisaToTaka, toBanglaDigits } from '@/lib/money';
import { expiryStatus } from '@/lib/business-rules';
import { L } from '@/lib/i18n/labels';
import type { Medicine, MedicineBatch, MedicineType, UnitType } from '@/types/db';

const TYPES: MedicineType[] = [
  'syrup', 'tablet', 'capsule', 'injection', 'drop', 'cream', 'powder', 'saline', 'other',
];
const UNITS: UnitType[] = ['piece', 'bottle', 'packet', 'tube', 'vial', 'sachet', 'box'];

type Tab = 'active' | 'inactive' | 'all';

export default function MedicinesPage() {
  const [meds, setMeds] = useState<Medicine[]>([]);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setMeds(await fetchAllMedicines()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return meds.filter((m) => {
      if (tab === 'active' && !m.is_active) return false;
      if (tab === 'inactive' && m.is_active) return false;
      if (!s) return true;
      return `${m.name} ${m.strength ?? ''}`.toLowerCase().includes(s)
        || (m.bn_name ?? '').toLowerCase().includes(s)
        || (m.generic_name ?? '').toLowerCase().includes(s)
        || (m.company ?? '').toLowerCase().includes(s);
    });
  }, [meds, q, tab]);

  function flash(text: string) {
    setMsg(text);
    setErr('');
    window.setTimeout(() => setMsg(''), 4000);
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'active', label: 'চালু' },
    { key: 'inactive', label: 'বন্ধ' },
    { key: 'all', label: 'সব' },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">{L.nav.medicines}</h1>
        <p className="text-sm text-gray-500">
          ওষুধের তথ্য সংশোধন করুন, ভুল দাম বা মেয়াদ ঠিক করুন, পুরোনো ওষুধ বন্ধ করুন। কিছুই মুছে যায় না।
        </p>
      </div>

      <div className="card space-y-3">
        <input
          className="input"
          placeholder="নাম, generic বা কোম্পানি দিয়ে খুঁজুন"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`badge ${tab === t.key ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto self-center text-sm text-gray-500">
            {toBanglaDigits(filtered.length)} টি ওষুধ
          </span>
        </div>
      </div>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}

      {filtered.length === 0 && (
        <p className="card text-center text-gray-400">কোনো ওষুধ পাওয়া যায়নি</p>
      )}

      <div className="space-y-3">
        {filtered.map((m) => (
          <MedicineCard
            key={m.id}
            med={m}
            open={openId === m.id}
            onToggle={() => setOpenId(openId === m.id ? null : m.id)}
            onSaved={async (text) => { flash(text); await load(); }}
            onError={setErr}
          />
        ))}
      </div>
    </div>
  );
}

function MedicineCard({
  med, open, onToggle, onSaved, onError,
}: {
  med: Medicine;
  open: boolean;
  onToggle: () => void;
  onSaved: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [form, setForm] = useState({
    name: med.name,
    bn_name: med.bn_name ?? '',
    strength: med.strength ?? '',
    generic_name: med.generic_name ?? '',
    company: med.company ?? '',
    type: med.type,
    unit: med.unit,
    low_stock_threshold: med.low_stock_threshold == null ? '' : String(med.low_stock_threshold),
    note: med.note ?? '',
  });
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchBatchesForMedicine(med.id).then(setBatches).catch(() => setBatches([]));
  }, [open, med.id]);

  const totalQty = batches.reduce((a, b) => a + b.qty_in_stock, 0);

  async function reloadBatches() {
    setBatches(await fetchBatchesForMedicine(med.id));
  }

  async function save() {
    setBusy(true);
    try {
      const th = form.low_stock_threshold.trim();
      await updateMedicine(med.id, {
        name: form.name,
        bn_name: form.bn_name.trim() || null,
        strength: form.strength.trim() || null,
        generic_name: form.generic_name.trim() || null,
        company: form.company.trim() || null,
        type: form.type,
        unit: form.unit,
        low_stock_threshold: th === '' ? null : Number(th),
        note: form.note.trim() || null,
      });
      await onSaved('ওষুধের তথ্য সংরক্ষিত হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ');
    } finally { setBusy(false); }
  }

  async function remove() {
    const ok = window.confirm(
      `"${med.name}" সম্পূর্ণ মুছে ফেলবেন? এটি ফেরানো যাবে না। বিক্রয় বা batch থাকলে মোছা যাবে না — সেক্ষেত্রে বন্ধ করুন।`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteMedicine(med.id);
      await onSaved('ওষুধ মুছে ফেলা হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'মুছে ফেলা যায়নি');
    } finally { setBusy(false); }
  }

  async function toggleActive() {
    const turningOff = med.is_active;
    if (turningOff) {
      const ok = window.confirm(
        'এই ওষুধ বন্ধ করলে বিক্রয় ও স্টক তালিকায় আর দেখা যাবে না। পুরোনো হিসাব ঠিক থাকবে। বন্ধ করবেন?',
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await setMedicineActive(med.id, !med.is_active);
      await onSaved(
        turningOff
          ? (r.remaining_qty > 0
            ? `বন্ধ হয়েছে — সতর্কতা: স্টকে এখনো ${toBanglaDigits(r.remaining_qty)} ${L.unit[med.unit]} আছে`
            : 'ওষুধ বন্ধ হয়েছে')
          : 'ওষুধ আবার চালু হয়েছে',
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className={`card ${med.is_active ? '' : 'border-gray-300 bg-gray-50'}`}>
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onToggle}>
        <div>
          <p className="font-bold text-brand-dark">
            {med.name}{med.strength ? ` ${med.strength}` : ''}{' '}
            {!med.is_active && <span className="badge bg-gray-200 text-gray-600">বন্ধ</span>}
          </p>
          <p className="text-sm text-gray-500">
            {L.medicineType[med.type]} · {L.unit[med.unit]}
            {med.company ? ` · ${med.company}` : ''}
            {med.generic_name ? ` · ${med.generic_name}` : ''}
          </p>
        </div>
        <span className="text-2xl text-gray-400">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="নাম *" v={form.name} on={(v) => setForm({ ...form, name: v })} />
            <Field label="বাংলা নাম" v={form.bn_name} on={(v) => setForm({ ...form, bn_name: v })} />
            <Field label="পাওয়ার (যেমন 500 mg)" v={form.strength} on={(v) => setForm({ ...form, strength: v })} />
            <Field label="Generic নাম" v={form.generic_name} on={(v) => setForm({ ...form, generic_name: v })} />
            <Field label="কোম্পানি" v={form.company} on={(v) => setForm({ ...form, company: v })} />
            <div>
              <label className="label">ধরন</label>
              <select className="input" value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as MedicineType })}>
                {TYPES.map((t) => <option key={t} value={t}>{L.medicineType[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">একক</label>
              <select className="input" value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value as UnitType })}>
                {UNITS.map((u) => <option key={u} value={u}>{L.unit[u]}</option>)}
              </select>
            </div>
            <Field
              label="কম স্টকের সীমা (ফাঁকা রাখলে ধরন অনুযায়ী)"
              v={form.low_stock_threshold}
              on={(v) => setForm({ ...form, low_stock_threshold: v.replace(/[^0-9]/g, '') })}
            />
            <Field label="নোট" v={form.note} on={(v) => setForm({ ...form, note: v })} />
          </div>

          <div className="flex flex-wrap gap-3">
            <button className="btn-primary" disabled={busy} onClick={save}>{L.common.save}</button>
            <button className={med.is_active ? 'btn-danger' : 'btn-outline'} disabled={busy} onClick={toggleActive}>
              {med.is_active ? 'ওষুধ বন্ধ করুন' : 'আবার চালু করুন'}
            </button>
            <button className="btn-outline border-danger text-danger" disabled={busy || batches.length > 0}
              onClick={remove}
              title={batches.length > 0 ? 'batch থাকায় মোছা যাবে না' : ''}>
              মুছে ফেলুন
            </button>
            {batches.length > 0 && (
              <span className="self-center text-xs text-gray-500">batch থাকায় মোছা যাবে না</span>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-bold text-brand-dark">
              Batch ও দাম {batches.length > 0 && `(মোট স্টক ${toBanglaDigits(totalQty)} ${L.unit[med.unit]})`}
            </h3>
            {batches.length === 0 ? (
              <p className="text-sm text-gray-400">কোনো batch নেই। নতুন স্টক পেজ থেকে যোগ করুন।</p>
            ) : (
              <div className="space-y-2">
                {batches.map((b) => (
                  <BatchRow
                    key={b.id}
                    batch={b}
                    unit={med.unit}
                    onSaved={async (t) => { await reloadBatches(); await onSaved(t); }}
                    onError={onError}
                  />
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              পরিমাণ এখানে বদলানো যায় না। নষ্ট, হারানো বা ভুল এন্ট্রির জন্য স্টক সমন্বয় পেজ ব্যবহার করুন।
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function BatchRow({
  batch, unit, onSaved, onError,
}: {
  batch: MedicineBatch;
  unit: UnitType;
  onSaved: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    const ok = window.confirm(
      'এই batch মুছে ফেলবেন? স্টক এন্ট্রি, বিক্রয়, সমন্বয় বা রিটার্ন থাকলে মোছা যাবে না।',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteBatch(batch.id);
      await onSaved('Batch মুছে ফেলা হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'মুছে ফেলা যায়নি');
    } finally { setBusy(false); }
  }
  const [f, setF] = useState({
    batch_no: batch.batch_no ?? '',
    expiry_date: batch.expiry_date ?? '',
    purchase: String(paisaToTaka(batch.purchase_price_paisa)),
    sale: String(paisaToTaka(batch.sale_price_paisa)),
  });

  const st = expiryStatus(batch.expiry_date);
  const tone = st === 'expired' ? 'badge-danger'
    : st === 'd30' || st === 'd60' || st === 'd90' ? 'badge-low' : 'badge-normal';
  const stLabel = st === 'expired' ? 'মেয়াদ শেষ'
    : st === 'unknown' ? 'মেয়াদ নেই' : st === 'ok' ? 'মেয়াদ ঠিক' : 'শিগগির শেষ';

  async function save() {
    setBusy(true);
    try {
      await updateBatch(batch.id, {
        batch_no: f.batch_no.trim() || null,
        expiry_date: f.expiry_date || null,
        purchase_price_paisa: takaToPaisa(f.purchase),
        sale_price_paisa: takaToPaisa(f.sale),
      });
      setEdit(false);
      await onSaved('Batch সংশোধন হয়েছে');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ');
    } finally { setBusy(false); }
  }

  if (!edit) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-sm">
        <span className="font-semibold">{batch.batch_no || 'batch নম্বর নেই'}</span>
        <span className={tone}>{stLabel}</span>
        <span className="text-gray-600">মেয়াদ: {batch.expiry_date ? toBanglaDigits(batch.expiry_date) : '—'}</span>
        <span className="text-gray-600">স্টক: {toBanglaDigits(batch.qty_in_stock)} {L.unit[unit]}</span>
        <span className="text-gray-600">ক্রয়: {formatTaka(batch.purchase_price_paisa)}</span>
        <span className="text-gray-600">বিক্রয়: {formatTaka(batch.sale_price_paisa)}</span>
        <button className="ml-auto text-brand underline" onClick={() => setEdit(true)}>সংশোধন</button>
        <button className="text-danger underline disabled:opacity-40" disabled={busy} onClick={remove}>
          মুছুন
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl bg-brand-light p-3 md:grid-cols-4">
      <Field label="Batch নম্বর" v={f.batch_no} on={(v) => setF({ ...f, batch_no: v })} />
      <div>
        <label className="label">মেয়াদ</label>
        <input className="input" type="date" value={f.expiry_date}
          onChange={(e) => setF({ ...f, expiry_date: e.target.value })} />
      </div>
      <div>
        <label className="label">ক্রয়মূল্য (৳)</label>
        <input className="input" type="number" step="0.01" min="0" value={f.purchase}
          onChange={(e) => setF({ ...f, purchase: e.target.value })} />
      </div>
      <div>
        <label className="label">বিক্রয়মূল্য (৳)</label>
        <input className="input" type="number" step="0.01" min="0" value={f.sale}
          onChange={(e) => setF({ ...f, sale: e.target.value })} />
      </div>
      <div className="flex gap-3 md:col-span-4">
        <button className="btn-primary" disabled={busy} onClick={save}>{L.common.save}</button>
        <button className="btn-outline" disabled={busy} onClick={() => setEdit(false)}>{L.common.cancel}</button>
      </div>
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
