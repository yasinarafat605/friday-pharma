'use client';

import { getSupabaseClient, getActivePharmacyId, setActivePharmacyId } from './client';
import type { MemberRole, Membership, InvitePreview } from '@/types/db';

export interface SignUpOwnerParams {
  email: string;
  password: string;
  pharmacyName: string;
  ownerName?: string;
  phone?: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

export interface AuthState {
  userId: string | null;
  email: string | null;
  activePharmacyId: string | null;
  activeRole: MemberRole | null;
  memberships: Membership[];
}

/**
 * ১. সাইন আপ ও প্রথম মালিকানা প্রতিষ্ঠা (Bootstrap Owner)
 * ক্রম: Supabase Auth -> pharmacies-এ ইনসার্ট -> memberships-এ মালিক হিসেবে বুটস্ট্র্যাপ
 */
export async function signUpOwner({
  email,
  password,
  pharmacyName,
  ownerName,
  phone,
}: SignUpOwnerParams): Promise<{ userId: string; pharmacyId: string }> {
  const supabase = getSupabaseClient();

  // ১. Supabase একাউন্ট তৈরি
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authErr) throw new Error(authErr.message || 'নিবন্ধন ব্যর্থ হয়েছে');
  const user = authData.user;
  if (!user) throw new Error('ব্যবহারকারী তৈরি করা যায়নি');

  const pharmacyId = crypto.randomUUID();

  // ২. ফার্মেসি তৈরি (created_by নিজের auth.uid হতে হবে)
  const { error: pErr } = await supabase.from('pharmacies').insert({
    id: pharmacyId,
    name: pharmacyName.trim(),
    created_by: user.id,
  });

  if (pErr) {
    throw new Error(`ফার্মেসি তৈরি ব্যর্থ: ${pErr.message}`);
  }

  // ৩. can_bootstrap_owner পলিসির মাধ্যমে নিজেকে প্রথম মালিক হিসেবে বসানো
  const { error: mErr } = await supabase.from('memberships').insert({
    user_id: user.id,
    pharmacy_id: pharmacyId,
    role: 'owner',
    is_default: true,
    full_name: ownerName?.trim() || null,
    phone: phone?.trim() || null,
  });

  if (mErr) {
    throw new Error(`মালিকানা নিবন্ধন ব্যর্থ: ${mErr.message}`);
  }

  // ৪. সক্রিয় দোকান নির্ধারণ
  setActivePharmacyId(pharmacyId);

  return { userId: user.id, pharmacyId };
}

/**
 * ২. সাইন ইন ও সক্রিয় দোকান নির্ধারণ (Active Pharmacy Resolution)
 * - ১টি সদস্যপদ থাকলে স্বয়ংক্রিয়ভাবে সেটিই সক্রিয়
 * - একাধিক সদস্যপদ থাকলে সংরক্ষিত সক্রিয় দোকান অথবা ডিফল্ট দোকান সক্রিয়
 */
export async function signIn({
  email,
  password,
}: SignInParams): Promise<{
  userId: string;
  activePharmacyId: string | null;
  memberships: Membership[];
}> {
  const supabase = getSupabaseClient();

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr) throw new Error(authErr.message || 'ইমেইল বা পাসওয়ার্ড ভুল');
  const user = authData.user;
  if (!user) throw new Error('ব্যবহারকারীর তথ্য পাওয়া যায়নি');

  // সদস্যপদগুলো নামিয়ে আনা
  const { data: rawMemberships, error: mErr } = await supabase
    .from('memberships')
    .select('user_id, pharmacy_id, role, is_default, full_name, phone, joined_at, updated_at, pharmacies(id, name, created_by)')
    .eq('user_id', user.id);

  if (mErr) throw new Error(`সদস্যপদ লোড ব্যর্থ: ${mErr.message}`);

  const memberships = (rawMemberships || []) as unknown as Membership[];
  let resolvedPharmacyId: string | null = null;

  if (memberships.length === 1) {
    resolvedPharmacyId = memberships[0].pharmacy_id;
  } else if (memberships.length > 1) {
    const currentActive = getActivePharmacyId();
    const matchesCurrent = currentActive && memberships.some((m) => m.pharmacy_id === currentActive);
    if (matchesCurrent) {
      resolvedPharmacyId = currentActive;
    } else {
      const defaultM = memberships.find((m) => m.is_default);
      resolvedPharmacyId = defaultM ? defaultM.pharmacy_id : memberships[0].pharmacy_id;
    }
  }

  setActivePharmacyId(resolvedPharmacyId);

  return {
    userId: user.id,
    activePharmacyId: resolvedPharmacyId,
    memberships,
  };
}

/**
 * ৩. সাইন আউট
 */
export async function signOutUser(): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut().catch(() => {});
  setActivePharmacyId(null);
}

/**
 * ৪. আমন্ত্রণ কোড প্রিভিউ (R10 throttling সমন্বিত)
 */
export async function previewInvite(code: string): Promise<InvitePreview | null> {
  const supabase = getSupabaseClient();
  const trimmed = code.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase.rpc('invite_preview', {
    p_code: trimmed,
  });

  if (error) {
    throw new Error(error.message || 'কোড যাচাই ব্যর্থ হয়েছে');
  }

  if (!data || data.length === 0) return null;

  return data[0] as InvitePreview;
}

/**
 * ৫. আমন্ত্রণ কোড ব্যবহার করে দোকানে যোগ দেওয়া (redeem_invite)
 */
export async function redeemInvite(code: string): Promise<string> {
  const supabase = getSupabaseClient();
  const trimmed = code.trim();
  if (!trimmed) throw new Error('আমন্ত্রণ কোড দিন');

  const { data, error } = await supabase.rpc('redeem_invite', {
    p_code: trimmed,
  });

  if (error) {
    throw new Error(error.message || 'আমন্ত্রণ কোড গ্রহণ ব্যর্থ হয়েছে');
  }

  const pharmacyId = data as string;
  setActivePharmacyId(pharmacyId);
  return pharmacyId;
}

/**
 * ৬. সক্রিয় দোকান পরিবর্তন (Pharmacy Switcher)
 */
export function switchActivePharmacy(pharmacyId: string): void {
  setActivePharmacyId(pharmacyId);
}

/**
 * ৭. সদস্যপদ ত্যাগ করা (R7: শেষ মালিক হলে ডেটাবেস স্তরেই আটকায়)
 */
export async function leavePharmacy(pharmacyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('লগইন প্রয়োজন');

  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', user.id)
    .eq('pharmacy_id', pharmacyId);

  if (error) {
    throw new Error(error.message || 'সদস্যপদ ত্যাগ ব্যর্থ হয়েছে');
  }

  if (getActivePharmacyId() === pharmacyId) {
    setActivePharmacyId(null);
  }
}

/**
 * ৮. বর্তমান ব্যবহারকারীর সদস্যপদ তালিকা রিফ্রেশ করা
 */
export async function fetchUserMemberships(): Promise<Membership[]> {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, pharmacy_id, role, is_default, full_name, phone, joined_at, updated_at, pharmacies(id, name, created_by)')
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
  return (data || []) as unknown as Membership[];
}
