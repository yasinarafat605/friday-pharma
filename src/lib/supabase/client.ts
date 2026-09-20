'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_PHARMACY_KEY = 'fp_active_pharmacy_id';

export const SUPABASE_URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
export const SUPABASE_KEY_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';

let clientInstance: SupabaseClient | null = null;
let currentHeaderPharmacyId: string | null = null;

/**
 * কনফিগারেশনের তিনটি অবস্থা — পার্থক্যটাই এখানে আসল কাজ।
 *
 *   absent  — দুটি চলকই নেই। অ্যাপ পুরোপুরি অফলাইনে চলবে, ক্লাউড অংশ লুকানো
 *             থাকবে। এটি সমর্থিত অবস্থা, ত্রুটি নয় — কোথাও error লেখা হবে না।
 *   ok      — দুটিই আছে এবং মান পড়ার মতো।
 *   invalid — একটি আছে অন্যটি নেই, বা মান বিকৃত। এটি ভাঙা deploy যা কাজ করার
 *             ভান করছে। এখানে নিঃশব্দে চলা মানে সপ্তাহ পেরিয়ে যাওয়ার পর ধরা
 *             পড়া — তাই সঙ্গে সঙ্গে, জোরে, কোন চলকটি ভুল তা নাম ধরে বলা হয়।
 */
export type SupabaseConfig =
  | { status: 'absent' }
  | { status: 'ok'; url: string; key: string }
  | { status: 'invalid'; problems: string[] };

/** ভুলে রেখে যাওয়া placeholder — ধরা পড়তেই হবে। */
const PLACEHOLDER_KEYS = [
  'dummy-anon-key',
  'your-anon-key',
  'anon-key',
  'changeme',
  'replace-me',
  'todo',
];

/**
 * বিশুদ্ধ যাচাই — process.env ছোঁয় না, তাই সরাসরি পরীক্ষা করা যায়।
 * মন দিন: http://localhost:54321 বৈধ, কারণ `supabase start` ঠিক সেটিই দেয়।
 * নিষিদ্ধ শুধু placeholder ও বিকৃত মান, স্থানীয় ঠিকানা নয়।
 */
export function validateSupabaseConfig(
  rawUrl: string | undefined | null,
  rawKey: string | undefined | null,
): SupabaseConfig {
  const url = (rawUrl ?? '').trim();
  const key = (rawKey ?? '').trim();

  // দুটিই ফাঁকা — অফলাইন মোড, কোনো অভিযোগ নেই।
  if (!url && !key) return { status: 'absent' };

  const problems: string[] = [];

  if (!url) {
    problems.push(`${SUPABASE_URL_VAR} সেট করা হয়নি, অথচ ${SUPABASE_KEY_VAR} সেট করা আছে`);
  } else if (/\s/.test(url)) {
    problems.push(`${SUPABASE_URL_VAR}-এর মানে ফাঁকা জায়গা আছে — উদ্ধৃতি চিহ্ন বা newline ঢুকে গেছে কি?`);
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed) {
      problems.push(`${SUPABASE_URL_VAR} সম্পূর্ণ URL নয়: "${url}"`);
    } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      problems.push(`${SUPABASE_URL_VAR} http বা https হতে হবে, পাওয়া গেছে "${parsed.protocol}"`);
    } else if (!parsed.hostname) {
      problems.push(`${SUPABASE_URL_VAR}-এ কোনো hostname নেই: "${url}"`);
    }
  }

  if (!key) {
    problems.push(`${SUPABASE_KEY_VAR} সেট করা হয়নি, অথচ ${SUPABASE_URL_VAR} সেট করা আছে`);
  } else if (PLACEHOLDER_KEYS.includes(key.toLowerCase())) {
    problems.push(`${SUPABASE_KEY_VAR}-এ placeholder মান রয়ে গেছে: "${key}"`);
  } else if (/\s/.test(key)) {
    problems.push(`${SUPABASE_KEY_VAR}-এর মানে ফাঁকা জায়গা আছে — উদ্ধৃতি চিহ্ন বা newline ঢুকে গেছে কি?`);
  } else if (key.length < 20) {
    problems.push(`${SUPABASE_KEY_VAR} অস্বাভাবিক ছোট (${key.length} অক্ষর) — মান কাটা পড়েছে কি?`);
  }

  if (problems.length > 0) return { status: 'invalid', problems };
  return { status: 'ok', url, key };
}

/**
 * চলক দুটি পড়া। Next.js build-এর সময় এই দুটি লেখা হুবহু মানে বসিয়ে দেয়,
 * তাই নাম ধরে (process.env[...]) পড়া চলবে না — লিটারেলই রাখতে হবে।
 */
export function readSupabaseConfig(): SupabaseConfig {
  return validateSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** ক্লাউড অংশ দেখানো হবে কি — শুধু 'ok' হলেই। */
export function isSupabaseConfigured(): boolean {
  return readSupabaseConfig().status === 'ok';
}

/** ভাঙা deploy-এর বার্তা, দেখানোর জন্য। ঠিক থাকলে বা অফলাইন হলে null। */
export function getSupabaseConfigError(): string | null {
  const cfg = readSupabaseConfig();
  if (cfg.status !== 'invalid') return null;
  return `Supabase কনফিগারেশন ভুল — ${cfg.problems.join('; ')}`;
}

export function getActivePharmacyId(): string | null {
  if (typeof localStorage !== 'undefined') {
    const val = localStorage.getItem(ACTIVE_PHARMACY_KEY);
    if (val) return val;
  }
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(ACTIVE_PHARMACY_KEY);
  }
  return null;
}

export function setActivePharmacyId(pharmacyId: string | null): void {
  if (typeof localStorage !== 'undefined') {
    if (pharmacyId) {
      localStorage.setItem(ACTIVE_PHARMACY_KEY, pharmacyId);
    } else {
      localStorage.removeItem(ACTIVE_PHARMACY_KEY);
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    if (pharmacyId) {
      sessionStorage.setItem(ACTIVE_PHARMACY_KEY, pharmacyId);
    } else {
      sessionStorage.removeItem(ACTIVE_PHARMACY_KEY);
    }
  }
  resetSupabaseClient();
}

export function resetSupabaseClient(): void {
  clientInstance = null;
  currentHeaderPharmacyId = null;
}

/**
 * ক্লায়েন্ট। কোনো অবস্থাতেই dummy URL বা dummy key দিয়ে তৈরি হয় না —
 * কনফিগ না থাকলে বা বিকৃত হলে এখানেই থেমে যায়।
 */
export function getSupabaseClient(): SupabaseClient {
  const cfg = readSupabaseConfig();

  if (cfg.status === 'absent') {
    throw new Error(
      `Supabase কনফিগার করা হয়নি — ${SUPABASE_URL_VAR} ও ${SUPABASE_KEY_VAR} দুটিই দিন। ` +
      'না দিলে অ্যাপ অফলাইন মোডে চলে, তখন ক্লাউড অংশ ডাকা উচিত নয়।',
    );
  }
  if (cfg.status === 'invalid') {
    throw new Error(`Supabase কনফিগারেশন ভুল — ${cfg.problems.join('; ')}`);
  }

  const activePharmacy = getActivePharmacyId();
  if (clientInstance && currentHeaderPharmacyId === activePharmacy) {
    return clientInstance;
  }

  const headers: Record<string, string> = {};
  if (activePharmacy) {
    headers['x-pharmacy-id'] = activePharmacy;
  }

  clientInstance = createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // Next.js static export
    },
    global: {
      headers,
    },
  });

  currentHeaderPharmacyId = activePharmacy;
  return clientInstance;
}
