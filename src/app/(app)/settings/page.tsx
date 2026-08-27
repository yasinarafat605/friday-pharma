'use client';

import { useEffect, useState } from 'react';
import { fetchSettings, saveSettings } from '@/lib/data';
import { setPin, isValidPinFormat, PIN_LENGTH } from '@/lib/auth';
import { backupStatus } from '@/lib/business-rules';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { AppSettings } from '@/types/db';

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
    const np = prompt(`নতুন PIN দিন (ঠিক ${PIN_LENGTH} সংখ্যা):`);
    if (!np) return;
    if (!isValidPinFormat(np)) { alert(`PIN অবশ্যই ${PIN_LENGTH} সংখ্যার হতে হবে`); return; }
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
        <p><b>PIN রিসেট:</b> ভুলে গেলে লগইন স্ক্রিনে "PIN ভুলে গেছেন?" → ফোন নম্বরের শেষ ৪ সংখ্যা
          (<b>{phoneTail}</b>) দিয়ে নতুন PIN সেট করা যাবে। ফোন নম্বর বদলালে রিসেট কোডও বদলে যাবে।</p>
      </div>

      {msg && <p className="rounded bg-success/10 px-3 py-2 text-success">{msg}</p>}
      {err && <p className="rounded bg-danger/10 px-3 py-2 text-danger">{err}</p>}
      <div className="flex gap-3">
        <button className="btn-primary" onClick={save}>{L.common.save}</button>
        <button className="btn-outline" onClick={changePin}>PIN পরিবর্তন</button>
      </div>
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
