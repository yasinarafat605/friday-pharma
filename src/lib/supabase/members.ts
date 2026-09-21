'use client';

/**
 * সদস্য ও আমন্ত্রণ কোড সামলানোর ডেটা-স্তর।
 *
 * এখানে কোনো অনুমতি যাচাই করা হয় না — করা হয় সার্ভারে। প্রতিটি ডাক
 * RLS-এর ভেতর দিয়ে যায়:
 *   membership_select        — নিজের সারি, আর members.manage থাকলে সহকর্মীদেরও
 *   membership_update_admin  — ভূমিকা বদল; মালিক বানাতে পারেন কেবল মালিক
 *   membership_delete_admin  — সদস্য সরানো, নিজেকে নয়
 *   invite_manage (for all)  — চালু দোকানের আমন্ত্রণ কোড, members.manage লাগে
 *
 * তাই UI-র আড়াল করা সুবিধার জন্য, সুরক্ষার জন্য নয়। কেউ সরাসরি ঠিকানা লিখে
 * পর্দায় পৌঁছালেও সার্ভার তাকে কিছু দেখাবে না বা লিখতে দেবে না।
 *
 * **memberships-এ কোনো insert এখানে নেই।** সদস্যপদ তৈরির পথ দুটিই থাকে:
 * redeem_invite() আর signUpOwner()-এর bootstrap-owner ধাপ।
 *
 * সব ত্রুটি হুবহু উপরে পাঠানো হয় — সার্ভারের বাংলা বার্তা গিলে ফেলা বা
 * সাধারণ বার্তায় বদলে দেওয়া হয় না। R7-এর
 * 'দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না' ঠিক এই পথেই পর্দায় ওঠে।
 */

import { getSupabaseClient } from './client';
import { generateInviteCode } from './invite-code';
import type { MemberRole, ShopMember, ShopInvite } from '@/types/db';

/** চালু ভূমিকার অনুমতির তালিকা। role_permissions সব লগইন করা ব্যবহারকারী পড়তে পারেন। */
export async function fetchRolePermissions(role: MemberRole): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission')
    .eq('role', role);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { permission: string }).permission);
}

/** চালু দোকানের সদস্যতালিকা। members.manage না থাকলে সার্ভার কেবল নিজের সারিই দেয়। */
export async function listShopMembers(pharmacyId: string): Promise<ShopMember[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, pharmacy_id, role, is_default, full_name, phone, joined_at')
    .eq('pharmacy_id', pharmacyId)
    .order('joined_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ShopMember[];
}

/**
 * ভূমিকা বদল।
 *
 * মালিক বানানো আটকায় membership_update_admin-এর `(role <> 'owner' or is_owner())`।
 * শেষ মালিককে নামিয়ে দিলে R7-এর trigger ঠেকিয়ে দেয়। দুটোরই বার্তা হুবহু ওঠে।
 */
export async function updateMemberRole(
  userId: string,
  pharmacyId: string,
  role: MemberRole,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('memberships')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('pharmacy_id', pharmacyId);

  if (error) throw new Error(error.message);
}

/** সদস্য সরানো। নিজেকে সরানো membership_delete_admin-এই আটকানো, তাই UI-ও দেয় না। */
export async function removeMember(userId: string, pharmacyId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', userId)
    .eq('pharmacy_id', pharmacyId);

  if (error) throw new Error(error.message);
}

/** এখনো ব্যবহার হয়নি ও মেয়াদ আছে — এমন কোডগুলো। */
export async function listActiveInvites(pharmacyId: string): Promise<ShopInvite[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('invites')
    .select('code, pharmacy_id, role, expires_at, used_by, used_at, created_at')
    .eq('pharmacy_id', pharmacyId)
    .is('used_by', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ShopInvite[];
}

export interface CreateInviteParams {
  pharmacyId: string;
  role: MemberRole;
  /** কত দিন বৈধ। না দিলে schema-র ডিফল্ট সাত দিন। */
  validDays?: number;
}

/**
 * নতুন আমন্ত্রণ কোড।
 *
 * invites-এ সরাসরি insert করা চলে — memberships-এর মতো নয় — কারণ
 * invite_manage policy-ই দোকান ও অনুমতি দুটোই দাবি করে।
 *
 * ভূমিকা কোডের সঙ্গেই যায়। যিনি যোগ দিচ্ছেন তিনি নিজের ভূমিকা বাছতে পারেন না;
 * redeem_invite() ভূমিকাটি এই সারি থেকেই নেয়।
 */
export async function createInvite({
  pharmacyId,
  role,
  validDays,
}: CreateInviteParams): Promise<ShopInvite> {
  const supabase = getSupabaseClient();
  const code = generateInviteCode();

  const row: Record<string, unknown> = { code, pharmacy_id: pharmacyId, role };
  if (validDays && validDays > 0) {
    const until = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);
    row.expires_at = until.toISOString();
  }

  const { data, error } = await supabase
    .from('invites')
    .insert(row)
    .select('code, pharmacy_id, role, expires_at, used_by, used_at, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ShopInvite;
}

/** ব্যবহার হয়ে যাওয়া কোড ফেরানো যায় না, তাই শুধু অব্যবহৃতটিই মোছা হয়। */
export async function revokeInvite(code: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('invites')
    .delete()
    .eq('code', code)
    .is('used_by', null);

  if (error) throw new Error(error.message);
}
