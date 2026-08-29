'use client';

// মাইগ্রেশন চেকপয়েন্ট — schema বদলানোর ঠিক আগে পুরো ডেটার একটি ছবি।
//
// ছবিটি একই ডেটাবেসের ভেতরেই `_checkpoints` store-এ রাখা হয়। কারণ
// schema upgrade একটি transaction-এর ভেতরে চলে; একই ডেটাবেসে লিখলে ছবি ও
// পরিবর্তন একসাথে সফল হয় বা একসাথে বাতিল হয়। আলাদা ডেটাবেসে লিখলে
// upgrade আগে শেষ হয়ে যেতে পারত এবং ছবি অসম্পূর্ণ থেকে যেত।
//
// সীমা: ডেটাবেসটাই নষ্ট হলে ছবিও যাবে। তাই এটি এনক্রিপ্টেড ব্যাকআপের
// বিকল্প নয় — ওটি ডিভাইসের বাইরে থাকে, এটি ডিভাইসের ভেতরে দ্রুত ফেরার পথ।

import type { Transaction } from 'dexie';

/** এক-একটি সংরক্ষিত ছবি। */
export interface Checkpoint {
  id: string;
  created_at: string;
  /** কেন নেওয়া হয়েছিল, যেমন "schema 2 → 3" বা "restore করার আগে"। */
  reason: string;
  from_version: number;
  to_version: number;
  /** টেবিল-প্রতি সারির সংখ্যা — যাচাই করার সহজ উপায়। */
  table_counts: Record<string, number>;
  /** সম্পূর্ণ ডেটা। */
  tables: Record<string, unknown[]>;
}

/** কতগুলো ছবি রাখা হবে। পুরোনোগুলো নিজে থেকেই সরে যায়। */
export const MAX_CHECKPOINTS = 3;

/**
 * কোন ছবিগুলো রেখে কোনগুলো ফেলে দেওয়া হবে।
 * খাঁটি ফাংশন — তাই আলাদাভাবে পরীক্ষা করা যায়।
 */
export function selectCheckpointsToPrune(
  existing: { id: string; created_at: string }[],
  keep: number = MAX_CHECKPOINTS,
): string[] {
  const sorted = [...existing].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.slice(Math.max(0, keep)).map((c) => c.id);
}

/** ছবিটি বিশ্বাসযোগ্য কিনা — গোনা সংখ্যা ও আসল সারির সংখ্যা মেলে কিনা। */
export function verifyCheckpoint(cp: Checkpoint): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const [table, count] of Object.entries(cp.table_counts)) {
    const rows = cp.tables[table];
    if (!Array.isArray(rows)) {
      problems.push(`${table}: ডেটা নেই`);
    } else if (rows.length !== count) {
      problems.push(`${table}: গোনা ${count}, পাওয়া গেল ${rows.length}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'cp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

/**
 * upgrade transaction-এর ভেতর থেকে ডাকা হয়।
 * ঐ transaction-এ যেসব store আছে সেগুলোর সব সারি পড়ে একটি ছবি লেখে।
 *
 * ব্যর্থ হলে ছুঁড়ে দেয় না — ছবি তুলতে না পারলেও upgrade আটকে দেওয়া
 * অ্যাপটাকে অচল করে দিত, আর এই মুহূর্তের পরিবর্তনগুলো যোগ-করা মাত্র।
 * তবে কী ঘটেছে তা জানিয়ে দেয়।
 */
export async function writeCheckpointInTransaction(
  tx: Transaction,
  opts: { reason: string; fromVersion: number; toVersion: number; tables: readonly string[] },
): Promise<Checkpoint | null> {
  try {
    const tables: Record<string, unknown[]> = {};
    const table_counts: Record<string, number> = {};
    let total = 0;

    for (const name of opts.tables) {
      let rows: unknown[] = [];
      try {
        rows = await tx.table(name).toArray();
      } catch {
        continue; // এই version-এ store-টি নেই
      }
      tables[name] = rows;
      table_counts[name] = rows.length;
      total += rows.length;
    }

    // ফাঁকা ডেটাবেসে ছবি তোলার মানে নেই (নতুন ইনস্টল)
    if (total === 0) return null;

    const cp: Checkpoint = {
      id: newId(),
      created_at: new Date().toISOString(),
      reason: opts.reason,
      from_version: opts.fromVersion,
      to_version: opts.toVersion,
      table_counts,
      tables,
    };

    const store = tx.table('_checkpoints');
    await store.add(cp);

    const existing = (await store.toArray()) as Checkpoint[];
    for (const id of selectCheckpointsToPrune(existing)) {
      await store.delete(id);
    }
    return cp;
  } catch (e) {
    console.warn('[Friday Pharma] চেকপয়েন্ট নেওয়া যায়নি:', e);
    return null;
  }
}
