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
import BrandMark from '@/components/BrandMark';
import { useAuth } from '@/lib/supabase/AuthContext';
import {
  signIn, signUpOwner, previewInvite, redeemInvite,
} from '@/lib/supabase/auth';
import type { InvitePreview } from '@/types/db';
import { roleBn } from '@/lib/roles';

type CloudTab = 'signin' | 'signup' | 'invite';
type PinMode = 'loading' | 'setup' | 'enter' | 'reset';


export default function LoginPage() {
  const router = useRouter();
  const {
    user, isConfigured, configError, signOut, refreshMemberships, activePharmacyName,
  } = useAuth();

  const [pinMode, setPinMode] = useState<PinMode>('loading');
  const [cloudTab, setCloudTab] = useState<CloudTab>('signin');

  // Supabase Auth Form States
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pharmacyName, setPharmacyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');

  // Invite Form States
  const [inviteCode, setInviteCode] = useState('');
  const [invitePreviewData, setInvitePreviewData] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // PIN States
  const [pin, setPinInput] = useState('');
  const [confirm, setConfirm] = useState('');
  const [last4, setLast4] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // লগইন করা অবস্থায় যোগদানের প্যানেল আর PIN ফর্ম একসঙ্গে দেখা যায়, তাই
  // যোগদানের বার্তা আলাদা রাখা হয়েছে — নইলে একই কথা দুবার দেখাত।
  const [joinMsg, setJoinMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  // লগইন করা থাকলে বার্তা যোগদান-প্যানেলে, নইলে ট্যাবের উপরে।
  function reportInvite(kind: 'error' | 'ok', text: string) {
    if (user) setJoinMsg({ kind, text });
    else setError(text);
  }

  useEffect(() => {
    (async () => {
      await ensureSeeded();
      setPinMode(isPinSet() ? 'enter' : 'setup');
    })();
  }, []);

  function go() {
    unlock();
    router.replace('/dashboard');
  }

  // ---- Supabase Auth Actions ----
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('ইমেইল ও পাসওয়ার্ড দিন');

    setBusy(true);
    try {
      await signIn({ email: email.trim(), password });
      await refreshMemberships();
      setPinMode(isPinSet() ? 'enter' : 'setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'লগইন ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUpOwner(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('ইমেইল ও পাসওয়ার্ড দিন');
    if (!pharmacyName.trim()) return setError('ফার্মেসির নাম দিন');
    if (password.length < 6) return setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে');

    setBusy(true);
    try {
      await signUpOwner({
        email: email.trim(),
        password,
        pharmacyName: pharmacyName.trim(),
        ownerName: ownerName.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      await refreshMemberships();
      setPinMode(isPinSet() ? 'enter' : 'setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'নিবন্ধন ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function handlePreviewInvite(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setJoinMsg(null);
    const code = inviteCode.trim();
    if (!code) return reportInvite('error', 'আমন্ত্রণ কোড দিন');

    setPreviewLoading(true);
    try {
      const data = await previewInvite(code);
      if (!data) {
        reportInvite('error', 'আমন্ত্রণ কোডটি ভুল বা এর মেয়াদ শেষ');
        setInvitePreviewData(null);
      } else {
        setInvitePreviewData(data);
      }
    } catch (err) {
      // invite_preview() পাঁচবার ভুলের পর থামিয়ে দেয় (R10) — সেই বার্তাটিও
      // হুবহু ব্যবহারকারীর সামনে যায়, গিলে ফেলা হয় না।
      reportInvite('error', err instanceof Error ? err.message : 'কোড যাচাই ব্যর্থ হয়েছে');
      setInvitePreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  /**
   * আমন্ত্রণ গ্রহণ। ভূমিকা আমন্ত্রণ থেকেই আসে — এখানে memberships-এ সরাসরি
   * কোনো insert নেই, সবটাই redeem_invite() RPC-র ভেতরে। সফল হলে সেই ফাংশনই
   * নতুন pharmacy_id ফেরায় এবং সেটিই সক্রিয় দোকান হয়ে যায়।
   */
  async function handleRedeemInvite() {
    setError('');
    setJoinMsg(null);
    const code = inviteCode.trim();
    if (!code) return reportInvite('error', 'আমন্ত্রণ কোড দিন');

    const joiningName = invitePreviewData?.pharmacy_name ?? '';
    setBusy(true);
    try {
      await redeemInvite(code);
      await refreshMemberships();
      setInvitePreviewData(null);
      setInviteCode('');
      reportInvite('ok', joiningName
        ? `${joiningName}-এ যোগ দেওয়া হয়েছে। এখন PIN দিয়ে ভেতরে ঢুকুন।`
        : 'দোকানে যোগ দেওয়া হয়েছে। এখন PIN দিয়ে ভেতরে ঢুকুন।');
      setPinMode(isPinSet() ? 'enter' : 'setup');
    } catch (err) {
      // redeem_invite() ভুল/মেয়াদোত্তীর্ণ কোডে 'আমন্ত্রণ কোডটি ভুল বা মেয়াদ শেষ'
      // তোলে, আর লগইন ছাড়া ডাকা হলে 'লগইন ছাড়া যোগ দেওয়া যাবে না'।
      reportInvite('error', err instanceof Error ? err.message : 'আমন্ত্রণ গ্রহণ ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  // ---- Local 8-Digit PIN Actions ----
  async function onSetup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!isValidPinFormat(pin)) return setError(`PIN অবশ্যই ${toBanglaDigits(PIN_LENGTH)} সংখ্যার হতে হবে`);
    if (pin !== confirm) return setError('দুবার একই PIN দিন');
    setBusy(true);
    try {
      await setPin(pin);
      go();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ব্যর্থ');
    } finally {
      setBusy(false);
    }
  }

  async function onEnter(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const rem = lockRemainingMs();
    if (rem > 0) return setError(`অনেকবার ভুল — ${Math.ceil(rem / 1000)} সেকেন্ড পর চেষ্টা করুন`);
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (ok) go();
      else setError('PIN ভুল');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ব্যর্থ');
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!isValidPinFormat(pin)) return setError(`নতুন PIN অবশ্যই ${toBanglaDigits(PIN_LENGTH)} সংখ্যার হতে হবে`);
    if (pin !== confirm) return setError('দুবার একই নতুন PIN দিন');
    setBusy(true);
    try {
      await resetPinWithPhone(last4, pin);
      go();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ব্যর্থ');
    } finally {
      setBusy(false);
    }
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

  /**
   * আমন্ত্রণ কোডের অংশ। কোড *যাচাই* লগইন ছাড়াও চলে, কিন্তু *যোগ দেওয়া* চলে না —
   * redeem_invite() auth.uid() ছাড়া কাজ করে না। তাই একই প্যানেল দুই অবস্থায়
   * ব্যবহার হয়: লগইন না থাকলে যাচাই পর্যন্ত, লগইন থাকলে যোগ দেওয়া পর্যন্ত।
   */
  const invitePanel = (signedIn: boolean) => (
    <div className="space-y-3">
      <form onSubmit={handlePreviewInvite} className="space-y-2">
        <label className="label" htmlFor={signedIn ? 'invite-code-signed' : 'invite-code'}>
          আমন্ত্রণ কোড দিন
        </label>
        <div className="flex gap-2">
          <input
            id={signedIn ? 'invite-code-signed' : 'invite-code'}
            type="text"
            className="input uppercase font-mono tracking-wider"
            value={inviteCode}
            onChange={(e) => { setInviteCode(e.target.value); setInvitePreviewData(null); }}
            placeholder="INVITE-A-..."
            required
          />
          <button type="submit" className="btn-outline px-4 shrink-0" disabled={previewLoading || busy}>
            {previewLoading ? '...' : 'যাচাই'}
          </button>
        </div>
      </form>

      {invitePreviewData && (
        <div className="rounded-xl border border-brand/30 bg-brand-light/50 p-4 text-center space-y-2">
          <p className="text-xs text-gray-500">আমন্ত্রণ পাওয়া গেছে:</p>
          <p className="text-lg font-bold text-brand-dark">{invitePreviewData.pharmacy_name}</p>
          <p className="text-xs text-brand">
            দায়িত্ব: <span className="font-semibold">{roleBn(invitePreviewData.role)}</span>
          </p>
          <p className="text-[11px] text-gray-500">
            দায়িত্বটি আমন্ত্রণ কোড থেকেই আসে — আপনি বদলাতে পারবেন না।
          </p>

          {signedIn ? (
            <button
              type="button"
              className="btn-primary mt-2 w-full"
              disabled={busy}
              onClick={handleRedeemInvite}
            >
              {busy ? L.common.loading : `${invitePreviewData.pharmacy_name}-এ যোগ দিন`}
            </button>
          ) : (
            <>
              <p className="mt-2 text-xs text-gray-600">
                যোগ দিতে আগে নিজের একাউন্টে লগইন করুন, বা নতুন একাউন্ট খুলুন।
                কোডটি এখানেই থাকবে।
              </p>
              <button
                type="button"
                className="btn-primary mt-2 w-full"
                onClick={() => { setCloudTab('signin'); setError(''); }}
              >
                লগইন করে আমন্ত্রণ গ্রহণ করুন
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  // যদি Supabase কনফিগার করা থাকে এবং ব্যবহারকারী লগইন না থাকেন, তখন Cloud Auth কার্ড দেখানো হবে
  const showCloudAuth = isConfigured && !user;

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-light p-4">
      <div className="card w-full max-w-md">
        <div className="mb-6 text-center">
          <BrandMark className="mx-auto mb-3 h-16 w-auto" />
          <h1 className="text-2xl font-bold text-brand-dark">{L.appName}</h1>
          <p className="text-sm text-gray-500">{L.appNameBn}</p>
          <p className="text-gray-500">{L.tagline}</p>
          {!isConfigured && !configError && (
            <span className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
              অফলাইন লোকাল মোড
            </span>
          )}
        </div>

        {/* ভাঙা deploy — নিঃশব্দে চলতে দেওয়া যায় না */}
        {configError && (
          <div className="mb-4 rounded-lg border-2 border-danger bg-danger/10 px-4 py-3 text-danger">
            <p className="text-sm font-bold">সার্ভার সেটিংস ভুল — ক্লাউড বন্ধ রাখা হয়েছে</p>
            <p className="mt-1 break-words text-xs">{configError}</p>
            <p className="mt-1 text-xs text-gray-600">
              এই ডিভাইসে অফলাইন কাজ চলবে, কিন্তু কিছুই সার্ভারে যাবে না।
              যিনি অ্যাপটি বসিয়েছেন তাঁকে দেখান।
            </p>
          </div>
        )}

        {/* Cloud Authentication Tabs */}
        {showCloudAuth && (
          <div className="space-y-4">
            <div className="flex border-b border-gray-200 text-sm font-medium text-center">
              <button
                type="button"
                className={`flex-1 py-2 border-b-2 ${
                  cloudTab === 'signin' ? 'border-brand text-brand font-bold' : 'border-transparent text-gray-500'
                }`}
                onClick={() => { setCloudTab('signin'); setError(''); }}
              >
                লগইন
              </button>
              <button
                type="button"
                className={`flex-1 py-2 border-b-2 ${
                  cloudTab === 'signup' ? 'border-brand text-brand font-bold' : 'border-transparent text-gray-500'
                }`}
                onClick={() => { setCloudTab('signup'); setError(''); }}
              >
                নতুন দোকান
              </button>
              <button
                type="button"
                className={`flex-1 py-2 border-b-2 ${
                  cloudTab === 'invite' ? 'border-brand text-brand font-bold' : 'border-transparent text-gray-500'
                }`}
                onClick={() => { setCloudTab('invite'); setError(''); }}
              >
                আমন্ত্রণ কোড
              </button>
            </div>

            {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>}

            {/* ১. সাইন ইন */}
            {cloudTab === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-3">
                <div>
                  <label className="label" htmlFor="login-email">ইমেইল</label>
                  <input
                    id="login-email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="login-password">পাসওয়ার্ড</label>
                  <input
                    id="login-password"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? L.common.loading : 'একাউন্টে প্রবেশ করুন'}
                </button>
              </form>
            )}

            {/* ২. নতুন দোকান নিবন্ধন (Bootstrap Owner) */}
            {cloudTab === 'signup' && (
              <form onSubmit={handleSignUpOwner} className="space-y-3">
                <p className="rounded-lg bg-brand-light px-3 py-2 text-center text-xs text-brand-dark">
                  নতুন ফার্মেসি খুলুন এবং নিজেকে মালিক হিসেবে নিবন্ধন করুন
                </p>
                <div>
                  <label className="label" htmlFor="reg-pharmacy">ফার্মেসির নাম *</label>
                  <input
                    id="reg-pharmacy"
                    type="text"
                    className="input"
                    value={pharmacyName}
                    onChange={(e) => setPharmacyName(e.target.value)}
                    placeholder="যেমন: সেবা ফার্মেসী"
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="reg-owner">মালিকের নাম</label>
                  <input
                    id="reg-owner"
                    type="text"
                    className="input"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="আপনার নাম"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="reg-phone">ফোন নম্বর</label>
                  <input
                    id="reg-phone"
                    type="tel"
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="017xxxxxxxx"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="reg-email">ইমেইল *</label>
                  <input
                    id="reg-email"
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@example.com"
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="reg-password">পাসওয়ার্ড *</label>
                  <input
                    id="reg-password"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="কমপক্ষে ৬ অক্ষর"
                    required
                  />
                </div>
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? L.common.loading : 'দোকান ও একাউন্ট তৈরি করুন'}
                </button>
              </form>
            )}

            {/* ৩. আমন্ত্রণ কোড যাচাই (যোগ দেওয়া লগইনের পরে) */}
            {cloudTab === 'invite' && invitePanel(false)}
          </div>
        )}

        {/* Local 8-Digit PIN Lock Interface */}
        {!showCloudAuth && (
          <div>
            {user && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs">
                <div>
                  <span className="font-semibold text-gray-700">{user.email}</span>
                  {activePharmacyName && <span className="block text-brand">{activePharmacyName}</span>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await signOut();
                    setPinMode('enter');
                  }}
                  className="text-danger underline"
                >
                  লগআউট
                </button>
              </div>
            )}

            {/* যোগদানের জায়গা। লগইনের পরে ক্লাউড ট্যাবগুলো লুকিয়ে যায়, তাই
                আমন্ত্রণ গ্রহণের একমাত্র পথ এটিই। অন্য দোকানে যোগ দিতেও কাজে লাগে। */}
            {user && isConfigured && (
              <div className="mb-4 space-y-2 rounded-xl border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-600">আমন্ত্রণ কোড দিয়ে দোকানে যোগ দিন</p>
                {invitePanel(true)}
                {joinMsg && (
                  <p
                    className={`rounded-lg px-3 py-2 text-sm ${
                      joinMsg.kind === 'ok'
                        ? 'bg-brand-light text-brand-dark'
                        : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {joinMsg.text}
                  </p>
                )}
              </div>
            )}

            {pinMode === 'loading' && <p className="text-center text-gray-500">{L.common.loading}</p>}

            {pinMode === 'setup' && (
              <form onSubmit={onSetup} className="space-y-4">
                <p className="rounded-lg bg-brand-light px-4 py-2 text-center text-sm text-brand-dark">
                  স্ক্রিন লক — এই ডিভাইসের জন্য একটি {toBanglaDigits(PIN_LENGTH)} সংখ্যার PIN তৈরি করুন
                </p>
                {pinInput(pin, setPinInput, 'নতুন PIN', 'pin')}
                {pinInput(confirm, setConfirm, 'PIN নিশ্চিত করুন', 'confirm')}
                {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger text-sm">{error}</p>}
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? L.common.loading : 'PIN সেট করুন ও প্রবেশ করুন'}
                </button>
              </form>
            )}

            {pinMode === 'enter' && (
              <form onSubmit={onEnter} className="space-y-4">
                {pinInput(pin, setPinInput, 'PIN দিন', 'pin')}
                {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger text-sm">{error}</p>}
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? L.common.loading : 'প্রবেশ করুন'}
                </button>
                <button
                  type="button"
                  className="w-full text-sm text-brand underline"
                  onClick={() => { setPinMode('reset'); setError(''); setPinInput(''); setConfirm(''); }}
                >
                  PIN ভুলে গেছেন?
                </button>
              </form>
            )}

            {pinMode === 'reset' && (
              <form onSubmit={onReset} className="space-y-4">
                <p className="rounded-lg bg-alert/10 px-4 py-2 text-center text-sm text-alert">
                  রেজিস্টার্ড ফোন নম্বরের শেষ ৪ সংখ্যা দিন, তারপর নতুন PIN
                </p>
                <div>
                  <label className="label" htmlFor="last4">ফোন নম্বরের শেষ ৪ সংখ্যা</label>
                  <input
                    id="last4"
                    inputMode="numeric"
                    maxLength={4}
                    className="input text-center text-xl tracking-[0.4em]"
                    value={last4}
                    onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="••••"
                  />
                </div>
                {pinInput(pin, setPinInput, 'নতুন PIN', 'pin')}
                {pinInput(confirm, setConfirm, 'নতুন PIN নিশ্চিত করুন', 'confirm')}
                {error && <p className="rounded-lg bg-danger/10 px-4 py-2 text-danger text-sm">{error}</p>}
                <button className="btn-primary w-full" disabled={busy}>
                  {busy ? L.common.loading : 'PIN রিসেট করে প্রবেশ করুন'}
                </button>
                <button
                  type="button"
                  className="w-full text-sm text-gray-500 underline"
                  onClick={() => { setPinMode('enter'); setError(''); setPinInput(''); setConfirm(''); }}
                >
                  ফিরে যান
                </button>
              </form>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          নিরাপদ ও অফলাইন-ফার্স্ট ফার্মেসি সিস্টেম
        </p>
      </div>
    </main>
  );
}
