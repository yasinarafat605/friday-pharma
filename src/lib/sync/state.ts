'use client';

// সিঙ্কের নিজের অবস্থা — কতদূর এগিয়েছে, আর কী কী আটকে আছে।
//
// এই টেবিলগুলো কেবল সিঙ্ক ইঞ্জিন লেখে, ব্যবসার কোনো transaction-এর ভেতরে নয়।
// সেজন্যই বিদ্যমান transaction-গুলোর scope বদলাতে হয় না।
//
// এখানে সিঙ্ক করার কোনো কোড নেই — শুধু হিসাব রাখার ব্যবস্থা। আসল
// পাঠানো-আনার কাজ পরের ধাপে, লগইন তৈরি হওয়ার পর।

import { db, uuid, nowISO } from '@/lib/db/local';
import type { SyncFailure, SyncState } from '@/types/db';

/** যেসব টেবিল সার্ভারের সাথে মেলে। */
export const SYNC_TABLES = [
  'medicines', 'batches', 'stock_entries', 'customers', 'customer_ledger',
  'sales', 'sale_items', 'due_payments', 'expense_categories', 'expenses',
  'cash_sessions', 'stock_adjustments', 'sale_returns', 'sale_return_items',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

// ============================================================
// আবার চেষ্টার সময় — খাঁটি ফাংশন, আলাদাভাবে পরীক্ষা করা যায়
// ============================================================

/** কত সেকেন্ড পর আবার চেষ্টা হবে। ধাপে ধাপে বাড়ে, এক ঘণ্টায় থামে। */
const BACKOFF_SECONDS = [5, 30, 120, 600, 3600];

export function retryDelaySeconds(attempts: number): number {
  if (attempts <= 0) return BACKOFF_SECONDS[0]!;
  const i = Math.min(attempts - 1, BACKOFF_SECONDS.length - 1);
  return BACKOFF_SECONDS[i]!;
}

/**
 * আবার চেষ্টা করা উচিত কিনা।
 * নেটওয়ার্কের সমস্যা হলে চিরকাল চেষ্টা চলে — একসময় ইন্টারনেট ফিরবে।
 * সার্ভার সারিটি প্রত্যাখ্যান করলে বারবার পাঠিয়ে লাভ নেই, পাঁচবারেই থামে।
 */
export function shouldRetry(attempts: number, kind: 'network' | 'rejected'): boolean {
  if (kind === 'network') return true;
  return attempts < 5;
}

export function nextRetryAt(attempts: number, from: Date = new Date()): string {
  return new Date(from.getTime() + retryDelaySeconds(attempts) * 1000).toISOString();
}

// ============================================================
// কতদূর এগিয়েছে
// ============================================================

export async function getSyncState(table: SyncTable): Promise<SyncState> {
  const row = await db().sync_state.get(table);
  return row ?? { table_name: table, last_pulled_at: null, last_pushed_at: null, last_error: null };
}

export async function setSyncState(table: SyncTable, patch: Partial<SyncState>): Promise<void> {
  const cur = await getSyncState(table);
  await db().sync_state.put({ ...cur, ...patch, table_name: table });
}

// ============================================================
// পাঠানো বাকি সারি
// ============================================================

/** কতগুলো সারি এখনো সার্ভারে যায়নি — উপরে দেখানোর জন্য। */
export async function countPending(): Promise<number> {
  const d = db();
  let total = 0;
  for (const name of SYNC_TABLES) {
    const table = (d as unknown as Record<string, { where: (k: string) => { equals: (v: number) => { count: () => Promise<number> } } }>)[name];
    if (!table) continue;
    total += await table.where('dirty').equals(1).count();
  }
  return total;
}

/**
 * সারিটি পাঠানো হয়ে গেছে বলে চিহ্নিত করা।
 * dirty ও updated_at দুটোই স্পষ্টভাবে দেওয়া হয়, তাই hook সেগুলো বদলায় না —
 * এখানেই অসীম চক্র থেমে যায়।
 */
export async function markSynced(
  table: SyncTable, id: string, serverUpdatedAt: string,
): Promise<void> {
  const t = (db() as unknown as Record<string, { update: (id: string, c: Record<string, unknown>) => Promise<number> }>)[table];
  await t.update(id, { dirty: 0, updated_at: serverUpdatedAt });
}

/** সব সারি আবার পাঠানোর তালিকায় ফেরানো — মেরামতের ব্যবস্থা। */
export async function markAllDirty(): Promise<number> {
  const d = db();
  let n = 0;
  for (const name of SYNC_TABLES) {
    const t = (d as unknown as Record<string, { toCollection: () => { modify: (f: (r: Record<string, unknown>) => void) => Promise<number> } }>)[name];
    if (!t) continue;
    n += await t.toCollection().modify((row) => { row.dirty = 1; });
  }
  return n;
}

// ============================================================
// আটকে থাকা সারি
// ============================================================

export async function recordFailure(
  table: SyncTable, rowId: string, error: string, kind: 'network' | 'rejected' = 'network',
): Promise<void> {
  const d = db();
  const existing = await d.sync_failures
    .where('row_id').equals(rowId)
    .filter((f) => f.table_name === table)
    .first();
  const attempts = (existing?.attempts ?? 0) + 1;
  const row: SyncFailure = {
    id: existing?.id ?? uuid(),
    table_name: table,
    row_id: rowId,
    attempts,
    last_error: error,
    next_retry_at: shouldRetry(attempts, kind) ? nextRetryAt(attempts) : '',
    created_at: existing?.created_at ?? nowISO(),
  };
  await d.sync_failures.put(row);
}

export async function clearFailure(table: SyncTable, rowId: string): Promise<void> {
  const d = db();
  const existing = await d.sync_failures
    .where('row_id').equals(rowId)
    .filter((f) => f.table_name === table)
    .first();
  if (existing) await d.sync_failures.delete(existing.id);
}

/** যেগুলো এখনই আবার চেষ্টা করার সময় হয়েছে। */
export async function dueFailures(at: Date = new Date()): Promise<SyncFailure[]> {
  const iso = at.toISOString();
  return (await db().sync_failures.toArray())
    .filter((f) => f.next_retry_at !== '' && f.next_retry_at <= iso);
}

/** যেগুলো আর চেষ্টা করা হবে না — ব্যবহারকারীকে জানাতে হবে। */
export async function stuckFailures(): Promise<SyncFailure[]> {
  return (await db().sync_failures.toArray()).filter((f) => f.next_retry_at === '');
}
