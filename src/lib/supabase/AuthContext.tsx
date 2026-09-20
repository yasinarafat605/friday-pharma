'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured, getActivePharmacyId, setActivePharmacyId } from './client';
import { fetchUserMemberships, signOutUser } from './auth';
import type { MemberRole, Membership } from '@/types/db';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isConfigured: boolean;
  activePharmacyId: string | null;
  activePharmacyName: string;
  activeRole: MemberRole | null;
  memberships: Membership[];
  selectPharmacy: (pharmacyId: string) => void;
  refreshMemberships: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  isConfigured: false,
  activePharmacyId: null,
  activePharmacyName: '',
  activeRole: null,
  memberships: [],
  selectPharmacy: () => {},
  refreshMemberships: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activePharmacyId, setActiveId] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

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

        let currentActive = getActivePharmacyId();
        const valid = list.some((m) => m.pharmacy_id === currentActive);
        if (!valid) {
          const def = list.find((m) => m.is_default);
          currentActive = def ? def.pharmacy_id : (list[0]?.pharmacy_id ?? null);
          setActivePharmacyId(currentActive);
        }
        setActiveId(currentActive);
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
          setActivePharmacyId(null);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, [configured, loadUserState]);

  const selectPharmacy = useCallback((pharmacyId: string) => {
    setActivePharmacyId(pharmacyId);
    setActiveId(pharmacyId);
  }, []);

  const refreshMemberships = useCallback(async () => {
    if (!user) return;
    const list = await fetchUserMemberships();
    setMemberships(list);
  }, [user]);

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
        activePharmacyId,
        activePharmacyName,
        activeRole,
        memberships,
        selectPharmacy,
        refreshMemberships,
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
