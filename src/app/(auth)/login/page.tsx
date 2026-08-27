'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  isPinSet, setPin, verifyPin, resetPinWithPhone, unlock,
  isValidPinFormat, lockRemainingMs, PIN_LENGTH,
} from '@/lib/auth';
import { ensureSeeded } from '@/lib/db/local';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';

type Mode = 'loading' | 'setup' | 'enter' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('loading');
  const [pin, setPinInput] = useState('');
  const [confirm, setConfirm] = useState('');
  const [last4, setLast4] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureSeeded();
      setMode(isPinSet() ? 'enter' : 'setup');
    })();
  }, []);

  function go() {
    unlock();
    router.replace('/dashboard');
  }

  async function onSetup(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!isValidPinFormat(pin)) return setError(`PIN অবশ্যই ${toBanglaDigits(PIN_LENGTH)} সংখ্যার হতে হবে`);
    if (pin !== confirm) return setError('দুবার একই PIN দিন');
    setBusy(true);
    try { await setPin(pin); go(); }
    catch (e) { setError(e instanceof Error ? e.message : 'ব্যর্থ'); }
    finally { setBusy(false); }
  }

  async function onEnter(e: React.FormEvent) {
    e.preventDefault(); setError('');
    const rem = lockRemainingMs();
    if (rem > 0) return setError(`অনেকবার ভুল — ${Math.ceil(rem / 1000)} সেকেন্ড পর চেষ্টা করুন`);
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (ok) go(); else setError('PIN ভুল');
    } catch (e) { setError(e instanceof Error ? e.message : 'ব্যর্থ'); }
    finally { setBusy(false); }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (!isValidPinFormat(pin)) return setError(`নতুন PIN অবশ্যই ${toBanglaDigits(PIN_LENGTH)} সংখ্যার হতে হবে`);
    if (pin !== confirm) return setError('দুবার একই নতুন PIN দিন');
    setBusy(true);
    try { await resetPinWithPhone(last4, pin); go(); }
    catch (e) { setError(e instanceof Error ? e.message : 'ব্যর্থ'); }
    finally { setBusy(false); }
  }

  const pinInput = (val: string, set: (v: string) => void, label: string, id: string) => (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input
        id={id} inputMode="numeric" autoComplete="off"
        maxLength={PIN_LENGTH}
        className="input text-center text-2xl tracking-[0.5em]"
        value={val}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
        placeholder={'•'.repeat(PIN_LENGTH)}
      />
    </div>
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-light p-4">
      <div className="card w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand text-2xl font-bold text-white">
            FP
          </div>
          <h1 className="text-2xl font-bold text-brand-dark">{L.appName}</h1>
          <p className="text-sm text-gray-500">{L.appNameBn}</p>
          <p className="text-gray-500">{L.tagline}</p>
        </div>

        {mode === 'loading' && <p className="text-center text-gray-500">{L.common.loading}</p>}

        {mode === 'setup' && (
          <form onSubmit={onSetup} className="space-y-4">
            <p className="rounded-lg bg-brand-light px-4 py-2 text-center text-sm text-brand-dark">
              প্রথমবার — একটি {toBanglaDigits(PIN_LENGTH)} সংখ্যার PIN তৈরি করুন
            </p>
            {pinInput(pin, setPinInput, 'নতুন PIN', 'pin')}
            {pinInput(confirm, setConfirm, 'PIN নিশ্চিত করুন', 'confirm')}
            {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? L.common.loading : 'PIN সেট করুন ও প্রবেশ করুন'}
            </button>
          </form>
        )}

        {mode === 'enter' && (
          <form onSubmit={onEnter} className="space-y-4">
            {pinInput(pin, setPinInput, 'PIN দিন', 'pin')}
            {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? L.common.loading : 'প্রবেশ করুন'}
            </button>
            <button type="button" className="w-full text-sm text-brand underline"
              onClick={() => { setMode('reset'); setError(''); setPinInput(''); setConfirm(''); }}>
              PIN ভুলে গেছেন?
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={onReset} className="space-y-4">
            <p className="rounded-lg bg-alert/10 px-4 py-2 text-center text-sm text-alert">
              রেজিস্টার্ড ফোন নম্বরের শেষ ৪ সংখ্যা দিন, তারপর নতুন PIN
            </p>
            <div>
              <label className="label" htmlFor="last4">ফোন নম্বরের শেষ ৪ সংখ্যা</label>
              <input id="last4" inputMode="numeric" maxLength={4}
                className="input text-center text-xl tracking-[0.4em]"
                value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••" />
            </div>
            {pinInput(pin, setPinInput, 'নতুন PIN', 'pin')}
            {pinInput(confirm, setConfirm, 'নতুন PIN নিশ্চিত করুন', 'confirm')}
            {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? L.common.loading : 'PIN রিসেট করে প্রবেশ করুন'}
            </button>
            <button type="button" className="w-full text-sm text-gray-500 underline"
              onClick={() => { setMode('enter'); setError(''); setPinInput(''); setConfirm(''); }}>
              ফিরে যান
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm text-gray-400">শুধুমাত্র দোকানের মালিকের জন্য</p>
      </div>
    </main>
  );
}
