'use client';

// PIN-ভিত্তিক নিরাপত্তা — সম্পূর্ণ local, কোনো server নেই।
// ৮ ডিজিটের PIN। PIN কখনো plain সংরক্ষণ হয় না — salt সহ SHA-256 hash।
// ভুলে গেলে ফোন নম্বরের শেষ ৪ ডিজিট দিয়ে নতুন PIN সেট করা যায়।
import { getSettings, DEFAULT_PHONE } from '@/lib/db/local';

const PIN_KEY = 'asshifa_pin';       // localStorage: { salt, hash }
const UNLOCK_KEY = 'asshifa_unlocked'; // sessionStorage flag
const FAIL_KEY = 'asshifa_pin_fails';
const LOCK_KEY = 'asshifa_pin_lock_until';

const MAX_FAILS = 5;
const LOCK_MS = 60_000;

export const PIN_LENGTH = 8;

export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder().encode(saltHex + ':' + pin);
  // একাধিক রাউন্ড — brute-force কঠিন করতে
  let buf = await crypto.subtle.digest('SHA-256', enc);
  for (let i = 0; i < 5000; i++) buf = await crypto.subtle.digest('SHA-256', buf);
  return toHex(buf);
}

function randomSaltHex(): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(a).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isPinSet(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return !!localStorage.getItem(PIN_KEY);
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) throw new Error(`PIN অবশ্যই ${PIN_LENGTH} সংখ্যার হতে হবে`);
  const salt = randomSaltHex();
  const hash = await hashPin(pin, salt);
  localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash }));
  clearFails();
}

// লক অবস্থা (বারবার ভুল PIN)
export function lockRemainingMs(): number {
  if (typeof localStorage === 'undefined') return 0;
  const until = Number(localStorage.getItem(LOCK_KEY) || 0);
  return Math.max(0, until - Date.now());
}
function clearFails() {
  localStorage.removeItem(FAIL_KEY);
  localStorage.removeItem(LOCK_KEY);
}
function registerFail() {
  const n = Number(localStorage.getItem(FAIL_KEY) || 0) + 1;
  localStorage.setItem(FAIL_KEY, String(n));
  if (n >= MAX_FAILS) {
    localStorage.setItem(LOCK_KEY, String(Date.now() + LOCK_MS));
    localStorage.setItem(FAIL_KEY, '0');
  }
}

export async function verifyPin(pin: string): Promise<boolean> {
  if (lockRemainingMs() > 0) throw new Error('অনেকবার ভুল হয়েছে — কিছুক্ষণ পর চেষ্টা করুন');
  const raw = localStorage.getItem(PIN_KEY);
  if (!raw) return false;
  const { salt, hash } = JSON.parse(raw) as { salt: string; hash: string };
  const test = await hashPin(pin, salt);
  const ok = test === hash;
  if (ok) { unlock(); clearFails(); } else { registerFail(); }
  return ok;
}

// ---- session lock ----
export function unlock(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.setItem(UNLOCK_KEY, '1');
}
export function lock(): void {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(UNLOCK_KEY);
}
export function isUnlocked(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  return sessionStorage.getItem(UNLOCK_KEY) === '1';
}

// ---- reset via ফোন নম্বরের শেষ ৪ ডিজিট ----
export async function resetCodeMatches(last4: string): Promise<boolean> {
  const s = await getSettings().catch(() => null);
  const phone = (s?.phone || DEFAULT_PHONE).replace(/\D/g, '');
  return phone.slice(-4) === last4.replace(/\D/g, '');
}

export async function resetPinWithPhone(last4: string, newPin: string): Promise<void> {
  const ok = await resetCodeMatches(last4);
  if (!ok) throw new Error('ফোন নম্বরের শেষ ৪ ডিজিট মেলেনি');
  await setPin(newPin);
}
