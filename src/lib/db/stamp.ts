'use client';

// প্রতিটি সারিতে সিঙ্কের ফিল্ড বসানোর নিয়ম।
//
// এখানে কোনো ডেটাবেস নেই — শুধু নিয়ম। তাই নিয়মগুলো আলাদাভাবে পরীক্ষা করা
// যায়, আর Dexie-র hook শুধু এগুলোকে ডাকে।
//
// মূল নিয়ম: **যে লিখছে সে যদি নিজে মান দেয়, সেটিই থাকে।**
//
// অ্যাপ সাধারণভাবে লিখলে কিছু দেয় না, তাই সারিটি "অপঠানো" (dirty) চিহ্ন
// পায় ও সময় বসে। সিঙ্ক ইঞ্জিন সার্ভার থেকে সারি নামিয়ে লেখার সময়
// নিজেই dirty = 0 ও সার্ভারের সময় দেয়, তাই সেটি আবার "বদলেছে" মনে হয় না।
//
// আগে updating hook শর্ত ছাড়াই সময় বসাত। ফলে সার্ভার থেকে নামানো সারিও
// স্থানীয়ভাবে বদলেছে মনে হতো, আবার উপরে যেত, আবার নামত — অসীম চক্র।

/** সারিতে যেসব ফিল্ড সিঙ্কের জন্য থাকে। */
export interface StampFields {
  pharmacy_id?: string;
  updated_at?: string;
  deleted_at?: string | null;
  /** ১ = এখনো সার্ভারে পাঠানো হয়নি। ০ = সার্ভারের সাথে মিল আছে। */
  dirty?: 0 | 1;
}

/** নতুন সারি তৈরির সময় — অনুপস্থিত ফিল্ডগুলো ভরে দেয়, দেওয়া মান ছোঁয় না। */
export function stampCreate(
  obj: Record<string, unknown>,
  pharmacyId: string,
  now: string,
): void {
  if (!obj.pharmacy_id) obj.pharmacy_id = pharmacyId;
  if (!obj.updated_at) obj.updated_at = now;
  if (obj.deleted_at === undefined) obj.deleted_at = null;
  if (obj.dirty === undefined) obj.dirty = 1;
}

/**
 * সারি বদলানোর সময় — কী কী বাড়তি বসবে তা ফেরত দেয়।
 * `mods` হলো যিনি লিখছেন তিনি যা যা বদলাতে চেয়েছেন।
 */
export function stampUpdate(
  mods: Record<string, unknown>,
  existing: Record<string, unknown>,
  pharmacyId: string,
  now: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  // লেখক নিজে সময় দিলে সেটিই থাকে (সিঙ্ক ইঞ্জিন সার্ভারের সময় দেয়)
  if (mods.updated_at === undefined) next.updated_at = now;

  // লেখক নিজে dirty দিলে সেটিই থাকে (সিঙ্ক ইঞ্জিন ০ দেয়)
  if (mods.dirty === undefined) next.dirty = 1;

  // পুরোনো সারিতে ফার্মেসি পরিচয় না থাকলে বসিয়ে দেওয়া
  if (!existing.pharmacy_id && mods.pharmacy_id === undefined) {
    next.pharmacy_id = pharmacyId;
  }
  return next;
}
