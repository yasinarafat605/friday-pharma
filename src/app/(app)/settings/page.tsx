'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchSettings, saveSettings, fetchExpenseCategories,
  addExpenseCategory, updateExpenseCategory, deleteExpenseCategory,
} from '@/lib/data';
import { setPin, isValidPinFormat, PIN_LENGTH } from '@/lib/auth';
import { backupStatus } from '@/lib/business-rules';
import { verifyStockIntegrity, type IntegrityReport } from '@/lib/stock/movements';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import { useAuth } from '@/lib/supabase/AuthContext';
import type { AppSettings, ExpenseCategory, MemberRole } from '@/types/db';

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try { setS(await fetchSettings()); }
      catch (e) { setErr(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
    })();
  }, []);

  async function save() {
    if (!s) return;
    setMsg(''); setErr('');
    try {
      await saveSettings(s);
      setMsg('সেটিংস সংরক্ষিত হয়েছে');
    } catch (e) { setErr(e instanceof Error ? e.message : 'সংরক্ষণ ব্যর্থ'); }
  }

  async function changePin() {
    const np = prompt(`নতুন PIN দিন (ঠিক ${toBanglaDigits(PIN_LENGTH)} সংখ্যা):`);
    if (!np) return;
    if (!isValidPinFormat(np)) { alert(`PIN অবশ্যই ${toBanglaDigits(PIN_LENGTH)} সংখ্যার হতে হবে`); return; }
    const cf = prompt('নতুন PIN আবার দিন:');
    if (cf !== np) { alert('দুবার একই PIN হয়নি'); return; }
    try { await setPin(np); alert('PIN পরিবর্তন হয়েছে'); }
    catch (e) { alert(e instanceof Error ? e.message : 'ব্যর্থ'); }
  }

  if (err && !s) return <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>;
  if (!s) return <p className="text-gray-500">{L.common.loading}</p>;

  const phoneTail = (s.phone ?? '').replace(/\D/g, '').slice(-4) || '—';

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-brand-dark">{L.nav.settings}</h1>

      <div className="card grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="ফার্মেসির নাম" v={s.pharmacy_name} on={(v) => setS({ ...s, pharmacy_name: v })} />
        <Field label="মালিকের নাম" v={s.owner_name ?? ''} on={(v) => setS({ ...s, owner_name: v })} />
        <Field label="ফোন নম্বর (PIN রিসেটে ব্যবহৃত)" v={s.phone ?? ''} on={(v) => setS({ ...s, phone: v })} />
        <Field label="ঠিকানা" v={s.address ?? ''} on={(v) => setS({ ...s, address: v })} />
        <NumField label="অটো-লক (মিনিট)" v={s.auto_lock_minutes} on={(v) => setS({ ...s, auto_lock_minutes: v })} />
        <NumField label="মেয়াদ সতর্কতা (দিন)" v={s.expiry_alert_days} on={(v) => setS({ ...s, expiry_alert_days: v })} />
        <NumField label="কম স্টক: সিরাপ" v={s.low_stock_syrup} on={(v) => setS({ ...s, low_stock_syrup: v })} />
        <NumField label="কম স্টক: ট্যাবলেট" v={s.low_stock_tablet} on={(v) => setS({ ...s, low_stock_tablet: v })} />
        <NumField label="কম স্টক: ক্যাপসুল" v={s.low_stock_capsule} on={(v) => setS({ ...s, low_stock_capsule: v })} />
        <NumField label="ব্যাকআপ মনে করানো (দিন)" v={s.backup_reminder_days}
          on={(v) => setS({ ...s, backup_reminder_days: Math.max(1, v) })} />
      </div>

      <div className="card space-y-1 text-sm text-gray-600">
        <p>
          <b>শেষ ব্যাকআপ:</b>{' '}
          {s.last_backup_at
            ? `${toBanglaDigits(s.last_backup_at.slice(0, 10))} (${toBanglaDigits(backupStatus(s.last_backup_at, s.backup_reminder_days).daysSince ?? 0)} দিন আগে)`
            : 'এখনো নেওয়া হয়নি'}
        </p>
        <p>
          এই সংখ্যার চেয়ে বেশি দিন পার হলে প্রতিটি পেজে ব্যাকআপ নেওয়ার সতর্কতা দেখাবে।
        </p>
      </div>

      <div className="card space-y-1 text-sm text-gray-600">
        <p><b>PIN রিসেট:</b> ভুলে গেলে লগইন স্ক্রিনে &quot;PIN ভুলে গেছেন?&quot; → ফোন নম্বরের শেষ ৪ সংখ্যা
          (<b>{phoneTail}</b>) দিয়ে নতুন PIN সেট করা যাবে। ফোন নম্বর বদলালে রিসেট কোডও বদলে যাবে।</p>
      </div>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      <div className="flex gap-3">
        <button className="btn-primary" onClick={save}>{L.common.save}</button>
        <button className="btn-outline" onClick={changePin}>PIN পরিবর্তন</button>
      </div>

      <CategoryManager onError={setErr} onMsg={setMsg} />
      <StockIntegrity onError={setErr} />
      <ShopMembership />
    </div>
  );
}

const ROLE_BN: Record<MemberRole, string> = {
  owner: 'মালিক',
  manager: 'ম্যানেজার',
  cashier: 'ক্যাশিয়ার',
  inventory: 'স্টক কর্মী',
  accountant: 'হিসাবরক্ষক',
};

/**
 * দোকান ও সদস্যপদ।
 *
 * সদস্যপদ ত্যাগ এখানে রাখা হয়েছে, হেডারে নয়। কারণ এটি বিরল ও ফিরে না-আসা কাজ:
 * হেডারের দোকান-বদল ড্রপডাউনের পাশে এমন বাটন থাকলে ভুল চাপ পড়া নিশ্চিত।
 * সেটিংস পাতাতেই ইতিমধ্যে PIN বদল আর স্টকের হিসাবের মতো একবারের কাজগুলো আছে।
 *
 * R7 — দোকানের শেষ মালিক বেরোতে পারেন না; বাধাটি ডেটাবেসে, আর তার বার্তাই
 * এখানে হুবহু দেখানো হয়।
 */
function ShopMembership() {
  const { user, isConfigured, memberships, activePharmacyId, leaveShop } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // অফলাইন মোডে কোনো সদস্যপদই নেই — কার্ডটি দেখানোর দরকার নেই।
  if (!isConfigured || !user) return null;

  async function leave(pharmacyId: string, name: string) {
    setMsg(''); setErr(''); setBusy(true);
    try {
      await leaveShop(pharmacyId);
      setMsg(`${name} থেকে আপনার সদস্যপদ বাদ দেওয়া হয়েছে।`);
      setConfirmId(null);
    } catch (e) {
      // 'দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না' — R7-এর বার্তা।
      setErr(e instanceof Error ? e.message : 'সদস্যপদ ত্যাগ ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-brand-dark">দোকান ও সদস্যপদ</h2>
      <p className="text-sm text-gray-600">{user.email}</p>

      {memberships.length === 0 && (
        <p className="text-sm text-gray-500">কোনো দোকানে সদস্যপদ নেই।</p>
      )}

      <ul className="space-y-2">
        {memberships.map((m) => {
          const name = m.pharmacies?.name || m.pharmacy_id.slice(0, 8);
          const isActive = m.pharmacy_id === activePharmacyId;
          return (
            <li key={m.pharmacy_id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-ink">
                    {name}
                    {isActive && <span className="ml-2 badge badge-normal">চালু</span>}
                  </p>
                  <p className="text-xs text-gray-500">দায়িত্ব: {ROLE_BN[m.role] ?? m.role}</p>
                </div>

                {confirmId === m.pharmacy_id ? (
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-danger px-3 py-1 text-sm font-semibold text-danger"
                      disabled={busy}
                      onClick={() => leave(m.pharmacy_id, name)}
                    >
                      {busy ? '...' : 'নিশ্চিত, বাদ দিন'}
                    </button>
                    <button
                      className="rounded-lg border border-gray-300 px-3 py-1 text-sm"
                      disabled={busy}
                      onClick={() => setConfirmId(null)}
                    >
                      থাক
                    </button>
                  </div>
                ) : (
                  <button
                    className="rounded-lg border border-danger px-3 py-1 text-sm font-semibold text-danger"
                    onClick={() => { setConfirmId(m.pharmacy_id); setErr(''); setMsg(''); }}
                  >
                    সদস্যপদ ত্যাগ
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-gray-500">
        সদস্যপদ ত্যাগ করলে এই দোকানের তথ্য আর দেখা যাবে না। দোকানের একমাত্র মালিক
        হলে ত্যাগ করা যাবে না — আগে অন্য কাউকে মালিক বানাতে হবে।
      </p>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
    </div>
  );
}

/**
 * স্টকের হিসাব মিলিয়ে দেখা।
 * প্রতিটি নড়াচড়া যোগ করে ব্যাচে লেখা সংখ্যার সাথে মিলিয়ে দেখে।
 * না মিললে কোন ওষুধে কত পার্থক্য তা দেখায়।
 */
function StockIntegrity({ onError }: { onError: (t: string) => void }) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setReport(null);
    try {
      setReport(await verifyStockIntegrity());
    } catch (e) {
      onError(e instanceof Error ? e.message : 'যাচাই ব্যর্থ');
    } finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-brand-dark">স্টকের হিসাব</h2>
      <p className="text-sm text-gray-600">
        প্রতিটি ওষুধের স্টক কীভাবে এই সংখ্যায় পৌঁছাল, তার পুরো হিসাব মিলিয়ে দেখা হয়।
        সন্দেহ হলে যেকোনো সময় চালাতে পারেন।
      </p>
      <button className="btn-outline" disabled={busy} onClick={run}>
        {busy ? 'মেলানো হচ্ছে…' : 'স্টকের হিসাব মিলিয়ে দেখুন'}
      </button>

      {report && !report.hasMovements && (
        <p className="rounded bg-alert/10 px-3 py-2 text-sm text-alert">
          এখনো স্টকের নড়াচড়ার হিসাব তৈরি হয়নি। অ্যাপটি একবার বন্ধ করে আবার খুলুন।
        </p>
      )}

      {report && report.hasMovements && report.ok && (
        <p className="rounded bg-success/10 px-3 py-2 text-sm text-success">
          সব ঠিক আছে — {toBanglaDigits(report.checked)} টি ব্যাচের হিসাব মিলেছে।
        </p>
      )}

      {report && report.hasMovements && !report.ok && (
        <div className="space-y-2">
          <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">
            {toBanglaDigits(report.mismatches.length)} টি ব্যাচে হিসাব মেলেনি।
            নিচের তালিকা দেখে জানান।
          </p>
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2">ব্যাচ</th>
                  <th className="px-3 py-2 text-right">লেখা আছে</th>
                  <th className="px-3 py-2 text-right">হিসাবে আসে</th>
                  <th className="px-3 py-2 text-right">পার্থক্য</th>
                </tr>
              </thead>
              <tbody>
                {report.mismatches.slice(0, 20).map((m) => (
                  <tr key={m.batch_id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs">{m.batch_id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right">{toBanglaDigits(m.counter)}</td>
                    <td className="px-3 py-2 text-right">{toBanglaDigits(m.computed)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-danger">
                      {toBanglaDigits(m.difference)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** খরচের ক্যাটাগরি যোগ, সংশোধন ও মুছে ফেলা। */
function CategoryManager({ onError, onMsg }: { onError: (t: string) => void; onMsg: (t: string) => void }) {
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCats(await fetchExpenseCategories()); }
    catch (e) { onError(e instanceof Error ? e.message : 'লোড ব্যর্থ'); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (!newName.trim()) { onError('ক্যাটাগরির নাম দিন'); return; }
    setBusy(true);
    try {
      await addExpenseCategory({ bn_name: newName });
      setNewName('');
      onMsg('ক্যাটাগরি যোগ হয়েছে');
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : 'ব্যর্থ'); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      await updateExpenseCategory(editId, { bn_name: editName });
      setEditId(null);
      onMsg('ক্যাটাগরি সংশোধন হয়েছে');
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : 'ব্যর্থ'); }
    finally { setBusy(false); }
  }

  async function remove(c: ExpenseCategory) {
    if (!window.confirm(`"${c.bn_name}" ক্যাটাগরি মুছে ফেলবেন? এই ক্যাটাগরিতে খরচ থাকলে মোছা যাবে না।`)) return;
    setBusy(true);
    try {
      await deleteExpenseCategory(c.id);
      onMsg('ক্যাটাগরি মুছে ফেলা হয়েছে');
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : 'মুছে ফেলা যায়নি'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-bold text-brand-dark">খরচের ক্যাটাগরি</h2>
      <div className="flex gap-2">
        <input className="input" placeholder="নতুন ক্যাটাগরির নাম"
          value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-primary whitespace-nowrap" disabled={busy} onClick={add}>
          {L.common.add}
        </button>
      </div>
      <ul className="space-y-2">
        {cats.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
            {editId === c.id ? (
              <>
                <input className="input flex-1" value={editName}
                  onChange={(e) => setEditName(e.target.value)} />
                <button className="btn-primary px-4 py-2 text-sm" disabled={busy} onClick={saveEdit}>
                  {L.common.save}
                </button>
                <button className="btn-outline px-4 py-2 text-sm" onClick={() => setEditId(null)}>
                  {L.common.cancel}
                </button>
              </>
            ) : (
              <>
                <span className="flex-1">
                  {c.bn_name}
                  {c.is_recurring && <span className="ml-2 badge bg-brand-light text-brand-dark">মাসিক</span>}
                </span>
                <button className="rounded-lg border border-brand px-3 py-1 text-sm font-semibold text-brand"
                  onClick={() => { setEditId(c.id); setEditName(c.bn_name); }}>
                  {L.common.edit}
                </button>
                <button className="rounded-lg border border-danger px-3 py-1 text-sm font-semibold text-danger"
                  disabled={busy} onClick={() => remove(c)}>
                  মুছুন
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (<div><label className="label">{label}</label>
    <input className="input" value={v} onChange={(e) => on(e.target.value)} /></div>);
}
function NumField({ label, v, on }: { label: string; v: number; on: (v: number) => void }) {
  return (<div><label className="label">{label}</label>
    <input className="input" type="number" min={0} value={v} onChange={(e) => on(Number(e.target.value))} /></div>);
}
