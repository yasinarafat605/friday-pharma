'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabaseClient, readSupabaseConfig, getActivePharmacyId } from './client';
import {
  fetchUserMemberships, signOutUser, switchActivePharmacy, leavePharmacy,
  resolveActivePharmacyId,
} from './auth';
import type { MemberRole, Membership } from '@/types/db';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  /** ভাঙা deploy-এর বার্তা। ঠিক থাকলে বা অফলাইন হলে null। */
  configError: string | null;
  activePharmacyId: string | null;
  activePharmacyName: string;
  activeRole: MemberRole | null;
  memberships: Membership[];
  selectPharmacy: (pharmacyId: string) => void;
  refreshMemberships: () => Promise<void>;
  /** সদস্যপদ ত্যাগ। শেষ মালিক হলে ডেটাবেসই আটকায় (R7) — বার্তাটি উপরে যায়। */
  leaveShop: (pharmacyId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isConfigured: false,
  configError: null,
  activePharmacyId: null,
  activePharmacyName: '',
  activeRole: null,
  memberships: [],
  selectPharmacy: () => {},
  refreshMemberships: async () => {},
  leaveShop: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activePharmacyId, setActiveId] = useState<string | null>(null);

  const cfg = readSupabaseConfig();
  const configured = cfg.status === 'ok';
  const configError = cfg.status === 'invalid'
    ? `Supabase কনফিগারেশন ভুল — ${cfg.problems.join('; ')}`
    : null;

  // ভাঙা deploy নিঃশব্দে চলতে দেওয়া যায় না — console-এও একবার জোরে বলা হয়।
  useEffect(() => {
    if (configError) console.error(configError);
  }, [configError]);

  const loadUserState = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }

    try {
      const supabase = getSupabaseClient();
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        const list = await fetchUserMemberships();
        setMemberships(list);

        const stored = getActivePharmacyId();
        const resolved = resolveActivePharmacyId(list, stored);
        if (resolved !== stored) switchActivePharmacy(resolved);
        setActiveId(resolved);
      } else {
        setMemberships([]);
        setActiveId(null);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    loadUserState();

    if (configured) {
      const supabase = getSupabaseClient();
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          loadUserState();
        } else {
          setMemberships([]);
          setActiveId(null);
          switchActivePharmacy(null);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, [configured, loadUserState]);

  const selectPharmacy = useCallback((pharmacyId: string) => {
    switchActivePharmacy(pharmacyId);
    setActiveId(pharmacyId);
  }, []);

  const refreshMemberships = useCallback(async () => {
    if (!user) return;
    const list = await fetchUserMemberships();
    setMemberships(list);

    // তালিকা বদলালে সক্রিয় দোকানও বদলাতে পারে — যেমন সদস্যপদ ত্যাগের পরে।
    const stored = getActivePharmacyId();
    const resolved = resolveActivePharmacyId(list, stored);
    if (resolved !== stored) switchActivePharmacy(resolved);
    setActiveId(resolved);
  }, [user]);

  // সদস্যপদ ত্যাগ। R7 শেষ মালিককে আটকায়; সেই ত্রুটি গিলে ফেলা হয় না।
  const leaveShop = useCallback(async (pharmacyId: string) => {
    await leavePharmacy(pharmacyId);
    const list = await fetchUserMemberships();
    setMemberships(list);
    const resolved = resolveActivePharmacyId(list, getActivePharmacyId());
    switchActivePharmacy(resolved);
    setActiveId(resolved);
  }, []);

  const signOut = useCallback(async () => {
    await signOutUser();
    setUser(null);
    setSession(null);
    setMemberships([]);
    setActiveId(null);
  }, []);

  const currentMembership = memberships.find((m) => m.pharmacy_id === activePharmacyId);
  const activeRole = currentMembership?.role ?? null;
  const activePharmacyName = currentMembership?.pharmacies?.name ?? '';

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        isConfigured: configured,
        configError,
        activePharmacyId,
        activePharmacyName,
        activeRole,
        memberships,
        selectPharmacy,
        refreshMemberships,
        leaveShop,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
