'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addStock, upsertMedicine, fetchMedicines,
  fetchRecentStockEntries, updateStockEntry, cancelStockEntry, type StockEntryRow,
} from '@/lib/data';
import { CancelButton, StatusBadge } from '@/components/CancelButton';
import { ScanPanel } from '@/components/ScanPanel';
import type { ParsedLabel } from '@/lib/scan/parse';
import { formatTaka, takaToPaisa, paisaToTaka, toBanglaDigits } from '@/lib/money';
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
  const [nm, setNm] = useState({
    name: '', strength: '', generic_name: '', company: '',
    type: 'tablet' as MedicineType, unit: 'piece' as UnitType,
  });
  // batch/stock
  const [batchNo, setBatchNo] = useState('');
  const [expiry, setExpiry] = useState('');
  const [qty, setQty] = useState('');
  const [purchase, setPurchase] = useState('');
  const [sale, setSale] = useState('');
  const [invoice, setInvoice] = useState('');

  // সাম্প্রতিক এন্ট্রি ও সংশোধন
  const [entries, setEntries] = useState<StockEntryRow[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [ef, setEf] = useState({ qty: '', purchase: '', sale: '', date: '', invoice: '', note: '' });

  const loadEntries = useCallback(async () => {
    setEntries(await fetchRecentStockEntries(30));
  }, []);

  const loadMeds = useCallback(async () => {
    setMedicines(await fetchMedicines());
  }, []);

  useEffect(() => { void loadMeds(); void loadEntries(); }, [loadMeds, loadEntries]);

  /** স্ক্যান থেকে পাওয়া তথ্য নতুন ওষুধের ফর্মে বসায়। দাম সবসময় হাতে দিতে হয়। */
  function applyScan(parsed: ParsedLabel) {
    setMode('new');
    setNm((prev) => ({
      ...prev,
      name: parsed.name || prev.name,
      strength: parsed.strength ?? prev.strength,
      generic_name: parsed.generic ?? prev.generic_name,
      company: parsed.company ?? prev.company,
      type: parsed.type ?? prev.type,
    }));
    setMsg('স্ক্যান থেকে তথ্য বসানো হয়েছে — যাচাই করে দাম দিন');
  }

  /** স্ক্যান করা ওষুধ আগে থেকেই তালিকায় থাকলে সেটিই নির্বাচন হয়। */
  function useExisting(id: string) {
    setMode('existing');
    setMedicineId(id);
    setMsg('তালিকায় থাকা ওষুধ নির্বাচন করা হয়েছে — batch, মেয়াদ ও দাম দিন');
  }

  function startEdit(r: StockEntryRow) {
    setEditId(r.id);
    setEf({
      qty: String(r.qty),
      purchase: String(paisaToTaka(r.purchase_price_paisa)),
      sale: String(paisaToTaka(r.sale_price_paisa)),
      date: r.entry_date,
      invoice: r.invoice_no ?? '',
      note: r.note ?? '',
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setErr(''); setMsg('');
    setBusy(true);
    try {
      await updateStockEntry(editId, {
        qty: Number(ef.qty),
        purchase_price_paisa: takaToPaisa(ef.purchase),
        sale_price_paisa: takaToPaisa(ef.sale),
        entry_date: ef.date,
        invoice_no: ef.invoice.trim() || null,
        note: ef.note.trim() || null,
      });
      setEditId(null);
      setMsg('স্টক এন্ট্রি সংশোধন হয়েছে');
      await loadEntries();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'সংশোধন ব্যর্থ');
    } finally { setBusy(false); }
  }

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
      if (mode === 'new') {
        setNm({ name: '', strength: '', generic_name: '', company: '', type: 'tablet', unit: 'piece' });
        await loadMeds();
      }
      await loadEntries();
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

      <ScanPanel
        medicines={medicines}
        onUseParsed={applyScan}
        onUseExisting={useExisting}
        onError={setErr}
      />

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
            <div><label className="label">পাওয়ার (যেমন 500 mg)</label>
              <input className="input" value={nm.strength} onChange={(e) => setNm({ ...nm, strength: e.target.value })} /></div>
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
            <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={purchase} onChange={(e) => setPurchase(e.target.value)} /></div>
          <div><label className="label">বিক্রয়মূল্য (৳ / একক)</label>
            <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={sale} onChange={(e) => setSale(e.target.value)} /></div>
        </div>

        {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
        {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}

        <button className="btn-primary w-full" disabled={busy}>{busy ? L.common.loading : 'স্টক যোগ করুন'}</button>
      </form>

      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">সাম্প্রতিক স্টক এন্ট্রি</h2>
        <p className="text-xs text-gray-500">
          ভুল পরিমাণ বা দাম সংশোধন করুন, অথবা পুরো এন্ট্রি বাতিল করুন। বাতিল করলে যোগ করা স্টক ফিরে যাবে।
          বিক্রি হয়ে গেলে বাতিল করা যাবে না।
        </p>
        {entries.length === 0 && <p className="text-gray-400">কোনো এন্ট্রি নেই</p>}
        <ul className="space-y-2">
          {entries.map((r) => (
            <li key={r.id} className={`rounded-xl px-3 py-2 ${
              r.status === 'cancelled' ? 'bg-gray-100' : 'bg-gray-50'}`}>
              {editId === r.id ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div><label className="label">পরিমাণ</label>
                    <input className="input" type="number" min={1} value={ef.qty}
                      onChange={(e) => setEf({ ...ef, qty: e.target.value })} /></div>
                  <div><label className="label">ক্রয়মূল্য (৳)</label>
                    <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={ef.purchase}
                      onChange={(e) => setEf({ ...ef, purchase: e.target.value })} /></div>
                  <div><label className="label">বিক্রয়মূল্য (৳)</label>
                    <input className="input" type="number" inputMode="decimal" step="0.01" min={0} value={ef.sale}
                      onChange={(e) => setEf({ ...ef, sale: e.target.value })} /></div>
                  <div><label className="label">তারিখ</label>
                    <input className="input" type="date" value={ef.date}
                      onChange={(e) => setEf({ ...ef, date: e.target.value })} /></div>
                  <div><label className="label">ইনভয়েস</label>
                    <input className="input" value={ef.invoice}
                      onChange={(e) => setEf({ ...ef, invoice: e.target.value })} /></div>
                  <div><label className="label">নোট</label>
                    <input className="input" value={ef.note}
                      onChange={(e) => setEf({ ...ef, note: e.target.value })} /></div>
                  <div className="flex gap-3 md:col-span-3">
                    <button className="btn-primary" disabled={busy} onClick={saveEdit}>{L.common.save}</button>
                    <button className="btn-outline" onClick={() => setEditId(null)}>{L.common.cancel}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">
                      {r.medicine_name} <StatusBadge status={r.status} />
                    </p>
                    <p className="text-xs text-gray-500">
                      {toBanglaDigits(r.entry_date)} · {toBanglaDigits(r.qty)} একক · ক্রয় {formatTaka(r.purchase_price_paisa)}
                      {r.batch_no ? ` · batch ${r.batch_no}` : ''}
                      {r.invoice_no ? ` · ইনভয়েস ${r.invoice_no}` : ''}
                    </p>
                    {r.cancelled_reason && (
                      <p className="text-xs text-danger">বাতিলের কারণ: {r.cancelled_reason}</p>
                    )}
                  </div>
                  {r.status !== 'cancelled' && (
                    <>
                      <button className="rounded-lg border border-brand px-3 py-1 text-sm font-semibold text-brand"
                        onClick={() => startEdit(r)}>
                        {L.common.edit}
                      </button>
                      <CancelButton
                        confirmText={`${r.medicine_name}-এর ${r.qty} একক স্টক এন্ট্রি বাতিল হবে এবং স্টক থেকে বাদ যাবে।`}
                        onCancel={(reason) => cancelStockEntry(r.id, reason)}
                        onError={setErr}
                        onDone={async () => { setMsg('স্টক এন্ট্রি বাতিল হয়েছে'); await loadEntries(); }}
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
