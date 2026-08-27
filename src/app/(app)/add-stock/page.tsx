'use client';

import { useEffect, useState } from 'react';
import { addStock, upsertMedicine, fetchMedicines } from '@/lib/data';
import { takaToPaisa } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { Medicine, MedicineType, UnitType } from '@/types/db';

const TYPES: MedicineType[] = ['syrup', 'tablet', 'capsule', 'injection', 'drop', 'cream', 'powder', 'saline', 'other'];
const UNITS: UnitType[] = ['piece', 'bottle', 'packet', 'tube', 'vial', 'sachet', 'box'];

export default function AddStockPage() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // existing selection
  const [medicineId, setMedicineId] = useState('');
  // new medicine
  const [nm, setNm] = useState({ name: '', generic_name: '', company: '', type: 'tablet' as MedicineType, unit: 'piece' as UnitType });
  // batch/stock
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qty, setQty] = useState('');
  const [purchase, setPurchase] = useState('');
  const [sale, setSale] = useState('');
  const [invoice, setInvoice] = useState('');

  async function loadMeds() {
    setMedicines(await fetchMedicines());
  }
  useEffect(() => { void loadMeds(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!qty || Number(qty) <= 0) return setErr('পরিমাণ ০-এর বেশি দিন');
    setBusy(true);
    try {
      let medId = medicineId;
      if (mode === 'new') {
        if (!nm.name.trim()) throw new Error('ওষুধের নাম দিন');
        const created = await upsertMedicine(nm);
        medId = created.id;
      }
      if (!medId) throw new Error('ওষুধ নির্বাচন করুন');

      const res = await addStock({
        medicine_id: medId,
        batch_no: batchNo || null,
        expiry_date: expiry || null,
        qty: Number(qty),
        purchase_price_paisa: takaToPaisa(purchase),
        sale_price_paisa: takaToPaisa(sale),
        entry_date: new Date().toISOString().slice(0, 10),
        invoice_no: invoice || null,
      });
      const queued = (res as { queued?: boolean })?.queued;
      setMsg(queued ? 'স্টক সংরক্ষিত (অফলাইন) — সিঙ্ক অপেক্ষমাণ' : 'স্টক সফলভাবে যোগ হয়েছে');
      setBatchNo(''); setExpiry(''); setQty(''); setPurchase(''); setSale(''); setInvoice('');
      if (mode === 'new') { setNm({ name: '', generic_name: '', company: '', type: 'tablet', unit: 'piece' }); await loadMeds(); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ব্যর্থ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.addStock}</h1>

      <div className="flex gap-2">
        <button className={`badge ${mode === 'existing' ? 'bg-brand text-white' : 'bg-gray-100'}`}
          onClick={() => setMode('existing')}>বিদ্যমান ওষুধ</button>
        <button className={`badge ${mode === 'new' ? 'bg-brand text-white' : 'bg-gray-100'}`}
          onClick={() => setMode('new')}>নতুন ওষুধ</button>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        {mode === 'existing' ? (
          <div>
            <label className="label">ওষুধ নির্বাচন</label>
            <select className="input" value={medicineId} onChange={(e) => setMedicineId(e.target.value)}>
              <option value="">— নির্বাচন করুন —</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>{m.name} {m.company ? `(${m.company})` : ''}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div><label className="label">ওষুধের নাম *</label>
              <input className="input" value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} /></div>
            <div><label className="label">জেনেরিক নাম</label>
              <input className="input" value={nm.generic_name} onChange={(e) => setNm({ ...nm, generic_name: e.target.value })} /></div>
            <div><label className="label">কোম্পানি</label>
              <input className="input" value={nm.company} onChange={(e) => setNm({ ...nm, company: e.target.value })} /></div>
            <div><label className="label">ধরন</label>
              <select className="input" value={nm.type} onChange={(e) => setNm({ ...nm, type: e.target.value as MedicineType })}>
                {TYPES.map((t) => <option key={t} value={t}>{L.medicineType[t]}</option>)}
              </select></div>
            <div><label className="label">একক (unit)</label>
              <select className="input" value={nm.unit} onChange={(e) => setNm({ ...nm, unit: e.target.value as UnitType })}>
                {UNITS.map((u) => <option key={u} value={u}>{L.unit[u]}</option>)}
              </select></div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div><label className="label">ব্যাচ নম্বর</label>
            <input className="input" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></div>
          <div><label className="label">মেয়াদ শেষের তারিখ</label>
            <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
          <div><label className="label">পরিমাণ *</label>
            <input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div><label className="label">ইনভয়েস নম্বর</label>
            <input className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></div>
          <div><label className="label">ক্রয়মূল্য (৳ / একক)</label>
            <input className="input" type="number" min={0} value={purchase} onChange={(e) => setPurchase(e.target.value)} /></div>
          <div><label className="label">বিক্রয়মূল্য (৳ / একক)</label>
            <input className="input" type="number" min={0} value={sale} onChange={(e) => setSale(e.target.value)} /></div>
        </div>

        {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

        <button className="btn-primary w-full" disabled={busy}>{busy ? L.common.loading : 'স্টক যোগ করুন'}</button>
      </form>
    </div>
  );
}
