'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const ACTIVE_PHARMACY_KEY = 'fp_active_pharmacy_id';

let clientInstance: SupabaseClient | null = null;
let currentHeaderPharmacyId: string | null = null;

export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
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

export function getSupabaseClient(): SupabaseClient {
  const activePharmacy = getActivePharmacyId();
  if (clientInstance && currentHeaderPharmacyId === activePharmacy) {
    return clientInstance;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-anon-key';

  const headers: Record<string, string> = {};
  if (activePharmacy) {
    headers['x-pharmacy-id'] = activePharmacy;
  }

  clientInstance = createClient(url, key, {
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
