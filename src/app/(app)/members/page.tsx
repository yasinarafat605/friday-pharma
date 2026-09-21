'use client';

/**
 * সদস্য ও আমন্ত্রণ — কেবল যাঁর members.manage আছে তাঁর জন্য।
 *
 * পর্দাটি Settings-এর ভেতরে না রেখে আলাদা ঠিকানায় রাখা হয়েছে, কারণ Settings
 * সব ভূমিকাই খোলে (PIN বদল, খরচের ক্যাটাগরি, স্টকের হিসাব)। ওখানে কার্ড
 * হিসেবে থাকলে আড়াল থাকাটা একটিমাত্র শর্তের উপর নির্ভর করত। আলাদা ঠিকানায়
 * মেনুর লিংক আর পর্দা — দুটোই একসঙ্গে অনুপস্থিত থাকে।
 *
 * **মন দিন:** এটি static export। তাই /members/ পাতাটি তৈরি হয়ে থাকে এবং
 * ঠিকানা লিখে যে কেউ খোলসটি পেতে পারেন। নিচের আড়াল করা সুবিধা ও বাড়তি স্তর,
 * **সুরক্ষার সীমানা নয়**। আসল সীমানা RLS: members.manage ছাড়া
 * membership_select কেবল নিজের সারি দেয়, invite_manage কিছুই দেয় না, আর
 * প্রতিটি লেখা সার্ভারেই আটকে যায়।
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/supabase/AuthContext';
import {
  listShopMembers, updateMemberRole, removeMember,
  listActiveInvites, createInvite, revokeInvite,
} from '@/lib/supabase/members';
import { formatForDisplay, INVITE_CODE_LENGTH } from '@/lib/supabase/invite-code';
import { selectableRolesFor, roleBn } from '@/lib/roles';
import { toBanglaDigits } from '@/lib/money';
import { L } from '@/lib/i18n/labels';
import type { MemberRole, ShopMember, ShopInvite } from '@/types/db';

const DAY_CHOICES = [1, 3, 7, 14, 30];

function banglaDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return toBanglaDigits(`${dd}/${mm}/${d.getFullYear()}`);
}

export default function MembersPage() {
  const router = useRouter();
  const { user, isConfigured, activePharmacyId, activeRole, can, loading } = useAuth();

  const [members, setMembers] = useState<ShopMember[]>([]);
  const [invites, setInvites] = useState<ShopInvite[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);

  // নতুন কোড তৈরির ফর্ম
  const [newRole, setNewRole] = useState<MemberRole>('cashier');
  const [newDays, setNewDays] = useState(7);
  const [freshCode, setFreshCode] = useState<ShopInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const mayManage = can('members.manage');
  const isOwner = activeRole === 'owner';

  const load = useCallback(async () => {
    if (!activePharmacyId) return;
    setErr('');
    try {
      const [m, i] = await Promise.all([
        listShopMembers(activePharmacyId),
        listActiveInvites(activePharmacyId),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'তালিকা লোড ব্যর্থ হয়েছে');
    } finally {
      setReady(true);
    }
  }, [activePharmacyId]);

  useEffect(() => {
    if (mayManage) load();
    else setReady(true);
  }, [mayManage, load]);

  // অনুমতি নেই — পর্দা দেখানোই হয় না, নিষ্ক্রিয় করে দেখানো হয় না।
  if (loading || !ready) {
    return <p className="text-center text-gray-500">{L.common.loading}</p>;
  }
  if (!isConfigured || !user || !mayManage) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-gray-600">এই পাতাটি আপনার জন্য নয়।</p>
        <button className="btn-outline" onClick={() => router.replace('/dashboard')}>
          ড্যাশবোর্ডে ফিরে যান
        </button>
      </div>
    );
  }

  async function changeRole(m: ShopMember, role: MemberRole) {
    if (role === m.role) return;
    setErr(''); setMsg(''); setBusy(true);
    try {
      await updateMemberRole(m.user_id, m.pharmacy_id, role);
      setMsg(`${m.full_name || 'সদস্য'}-এর দায়িত্ব এখন ${roleBn(role)}।`);
      await load();
    } catch (e) {
      // R7 — শেষ মালিককে নামালে এখানেই সেই বাংলা বার্তা ওঠে, হুবহু।
      setErr(e instanceof Error ? e.message : 'দায়িত্ব বদল ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function doRemove(m: ShopMember) {
    setErr(''); setMsg(''); setBusy(true);
    try {
      await removeMember(m.user_id, m.pharmacy_id);
      setMsg(`${m.full_name || 'সদস্য'}-কে দোকান থেকে বাদ দেওয়া হয়েছে।`);
      setConfirmRemove(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'সদস্য সরানো ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function makeCode() {
    if (!activePharmacyId) return;
    setErr(''); setMsg(''); setCopied(false); setBusy(true);
    try {
      const inv = await createInvite({
        pharmacyId: activePharmacyId,
        role: newRole,
        validDays: newDays,
      });
      setFreshCode(inv);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'আমন্ত্রণ কোড তৈরি ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function doRevoke(code: string) {
    setErr(''); setMsg(''); setBusy(true);
    try {
      await revokeInvite(code);
      setMsg('কোডটি বাতিল করা হয়েছে।');
      if (freshCode?.code === code) setFreshCode(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'কোড বাতিল ব্যর্থ হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
      setErr('কপি করা গেল না — কোডটি হাতে লিখে নিন।');
    }
  }

  // মালিক বানানো কেবল মালিকই পারেন (membership_update_admin)। নিয়মটি
  // selectableRolesFor()-এ একবারই লেখা, আর সেটিই পরীক্ষা করা হয়।
  const selectableRoles = selectableRolesFor(isOwner);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">সদস্য ও আমন্ত্রণ</h1>
        <p className="text-sm text-gray-500">এই দোকানে কারা কাজ করেন, আর কাকে ডাকা হয়েছে।</p>
      </div>

      {err && <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {msg && <p className="rounded bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}

      {/* ---- সদস্যতালিকা ---- */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">
          বর্তমান সদস্য ({toBanglaDigits(members.length)})
        </h2>

        {members.length === 0 && <p className="text-sm text-gray-500">কেউ নেই।</p>}

        <ul className="space-y-2">
          {members.map((m) => {
            const isMe = m.user_id === user.id;
            return (
              <li key={m.user_id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">
                      {m.full_name || 'নাম দেওয়া হয়নি'}
                      {isMe && <span className="ml-2 badge badge-normal">আপনি</span>}
                    </p>
                    <p className="text-xs text-gray-500">
                      দায়িত্ব: {roleBn(m.role)} · যোগ দিয়েছেন {banglaDate(m.joined_at)}
                      {m.phone ? ` · ${toBanglaDigits(m.phone)}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-sm"
                      value={m.role}
                      disabled={busy}
                      aria-label="দায়িত্ব বদল"
                      onChange={(e) => changeRole(m, e.target.value as MemberRole)}
                    >
                      {/* বর্তমান ভূমিকাটি সবসময় থাকে, নইলে তালিকায় সেটি দেখা যেত না */}
                      {Array.from(new Set<MemberRole>([m.role, ...selectableRoles])).map((r) => (
                        <option key={r} value={r}>{roleBn(r)}</option>
                      ))}
                    </select>

                    {/* নিজেকে সরানো membership_delete_admin-ই আটকায় — তাই বাটনই নেই।
                        নিজে বেরোতে চাইলে সেটিংসে "সদস্যপদ ত্যাগ" আছে (পর্ব ৪খ)। */}
                    {!isMe && (
                      confirmRemove === m.user_id ? (
                        <>
                          <button
                            className="rounded-lg border border-danger px-2 py-1 text-xs font-semibold text-danger"
                            disabled={busy}
                            onClick={() => doRemove(m)}
                          >
                            নিশ্চিত
                          </button>
                          <button
                            className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => setConfirmRemove(null)}
                          >
                            থাক
                          </button>
                        </>
                      ) : (
                        <button
                          className="rounded-lg border border-danger px-2 py-1 text-xs font-semibold text-danger"
                          onClick={() => { setConfirmRemove(m.user_id); setErr(''); setMsg(''); }}
                        >
                          বাদ দিন
                        </button>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {!isOwner && (
          <p className="text-xs text-gray-500">
            মালিক বানানোর কাজটি কেবল মালিকই করতে পারেন, তাই তালিকায় সেটি নেই।
          </p>
        )}
        <p className="text-xs text-gray-500">
          নিজেকে এখান থেকে বাদ দেওয়া যায় না। নিজে বেরোতে চাইলে সেটিংসে
          &quot;সদস্যপদ ত্যাগ&quot; ব্যবহার করুন।
        </p>
      </div>

      {/* ---- নতুন আমন্ত্রণ কোড ---- */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">নতুন আমন্ত্রণ কোড</h2>
        <p className="text-sm text-gray-600">
          কোডটি যে দায়িত্ব দেবে তা আপনি এখনই ঠিক করবেন। যিনি যোগ দিচ্ছেন তিনি
          নিজের দায়িত্ব বেছে নিতে পারবেন না।
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="new-role">দায়িত্ব</label>
            <select
              id="new-role"
              className="input"
              value={newRole}
              disabled={busy}
              onChange={(e) => setNewRole(e.target.value as MemberRole)}
            >
              {selectableRoles.map((r) => (
                <option key={r} value={r}>{roleBn(r)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="new-days">কত দিন বৈধ</label>
            <select
              id="new-days"
              className="input"
              value={newDays}
              disabled={busy}
              onChange={(e) => setNewDays(Number(e.target.value))}
            >
              {DAY_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {toBanglaDigits(d)} দিন{d === 7 ? ' (ডিফল্ট)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button className="btn-primary w-full" disabled={busy} onClick={makeCode}>
          {busy ? L.common.loading : 'কোড তৈরি করুন'}
        </button>

        {freshCode && (
          <div className="space-y-2 rounded-xl border-2 border-brand/40 bg-brand-light/50 p-4 text-center">
            <p className="text-xs text-gray-600">কোডটি একবারই দেখানো হচ্ছে — এখনই পাঠিয়ে দিন:</p>
            <p className="break-all font-mono text-2xl font-bold tracking-widest text-brand-dark">
              {formatForDisplay(freshCode.code).join(' ')}
            </p>
            <p className="text-xs text-brand">
              দায়িত্ব: <span className="font-semibold">{roleBn(freshCode.role)}</span>
              {' · মেয়াদ '}{banglaDate(freshCode.expires_at)} পর্যন্ত
            </p>
            <button className="btn-outline w-full" onClick={() => copyCode(freshCode.code)}>
              {copied ? 'কপি হয়েছে ✓' : 'কোড কপি করুন'}
            </button>
            <p className="text-[11px] text-gray-600">
              কোডটি <b>একবারই</b> ব্যবহার করা যাবে, আর মেয়াদ শেষ হলে নিজেই অচল হয়ে যাবে।
              ফাঁকা জায়গাগুলো শুধু পড়ার সুবিধার জন্য — কপি বাটন আসল কোডটিই নেয়
              ({toBanglaDigits(INVITE_CODE_LENGTH)} চিহ্ন)।
            </p>
          </div>
        )}
      </div>

      {/* ---- চালু কোডগুলো ---- */}
      <div className="card space-y-3">
        <h2 className="font-bold text-brand-dark">চালু কোড ({toBanglaDigits(invites.length)})</h2>
        {invites.length === 0 && (
          <p className="text-sm text-gray-500">এখন কোনো চালু কোড নেই।</p>
        )}
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.code}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 p-3"
            >
              <div>
                <p className="break-all font-mono text-sm font-semibold text-ink">
                  {formatForDisplay(inv.code).join(' ')}
                </p>
                <p className="text-xs text-gray-500">
                  {roleBn(inv.role)} · মেয়াদ {banglaDate(inv.expires_at)} পর্যন্ত
                </p>
              </div>
              <button
                className="rounded-lg border border-danger px-3 py-1 text-xs font-semibold text-danger"
                disabled={busy}
                onClick={() => doRevoke(inv.code)}
              >
                বাতিল করুন
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">
          ব্যবহার হয়ে যাওয়া কোড এই তালিকায় থাকে না — সেগুলো আর কাজেও লাগে না।
        </p>
      </div>
    </div>
  );
}
