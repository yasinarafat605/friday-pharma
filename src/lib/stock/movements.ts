'use client';

// স্টকের নড়াচড়া — ডেটাবেসের দিকটা।
//
// হিসাবের নিয়ম reconstruct.ts-এ (খাঁটি ফাংশন, আলাদাভাবে পরীক্ষিত)।
// এখানে শুধু ডেটাবেসে লেখা, পড়া, যাচাই আর মাইগ্রেশন।
//
// নিয়ম: এই সারিগুলো কখনো বদলায় না, কখনো মোছে না (নিয়ম I7)।
// ভুল হলে উল্টো চিহ্নের আরেকটি সারি লেখা হয়।

import { db, uuid, nowISO, todayISO, newClientTxnId } from '@/lib/db/local';
import type { MovementReason, StockMovement } from '@/types/db';
import { verifyAgainstCounters, businessDateOf, type VerifyRow } from '@/lib/stock/reconstruct';

// ============================================================
// লেখা
// ============================================================

export interface MovementInput {
  batch_id: string;
  medicine_id: string;
  qty_delta: number;
  reason: MovementReason;
  ref_type?: string | null;
  ref_id?: string | null;
  business_date?: string;
  note?: string | null;
}

/** নতুন সারি তৈরি করে — ব্যবসার transaction-এর ভেতর থেকে ডাকা হয়। */
export function buildMovement(input: MovementInput): StockMovement {
  return {
    id: uuid(),
    batch_id: input.batch_id,
    medicine_id: input.medicine_id,
    qty_delta: input.qty_delta,
    reason: input.reason,
    ref_type: input.ref_type ?? null,
    ref_id: input.ref_id ?? null,
    business_date: input.business_date ?? todayISO(),
    created_at: nowISO(),
    client_txn_id: newClientTxnId('mv'),
    note: input.note ?? null,
  } as StockMovement;
}

/**
 * নড়াচড়া লেখে। ডাকতে হয় সেই transaction-এর ভেতরেই যেখানে ব্যাচের
 * পরিমাণ বদলাচ্ছে — নইলে দুটি একসাথে সফল বা ব্যর্থ হবে না।
 */
export async function recordMovement(input: MovementInput): Promise<string> {
  const m = buildMovement(input);
  await db().stock_movements.add(m);
  return m.id;
}

// ============================================================
// পড়া
// ============================================================

/** এক ব্যাচের বর্তমান পরিমাণ — নড়াচড়া যোগ করে। */
export async function computeBatchQty(batchId: string): Promise<number> {
  const rows = await db().stock_movements.where('batch_id').equals(batchId).toArray();
  return rows.filter((m) => !m.deleted_at).reduce((a, m) => a + m.qty_delta, 0);
}

/** সব ব্যাচের পরিমাণ একবারে। */
export async function computeAllBatchQty(): Promise<Map<string, number>> {
  const rows = await db().stock_movements.toArray();
  const out = new Map<string, number>();
  for (const m of rows) {
    if (m.deleted_at) continue;
    out.set(m.batch_id, (out.get(m.batch_id) ?? 0) + m.qty_delta);
  }
  return out;
}

// ============================================================
// যাচাই (নিয়ম I2) — মাইগ্রেশনের যন্ত্র নয়, স্থায়ী সুবিধা
// ============================================================

export interface IntegrityReport {
  ok: boolean;
  checked: number;
  rows: VerifyRow[];
  mismatches: VerifyRow[];
  /** নড়াচড়ার ইতিহাস আদৌ তৈরি হয়েছে কিনা। */
  hasMovements: boolean;
}

/**
 * প্রতিটি ব্যাচে নড়াচড়ার যোগফল আর সংরক্ষিত সংখ্যা মেলে কিনা।
 * সেটিংসে "স্টকের হিসাব মিলিয়ে দেখুন" বাটন এটিই ডাকে।
 */
export async function verifyStockIntegrity(): Promise<IntegrityReport> {
  const d = db();
  const [batches, movements] = await Promise.all([
    d.batches.toArray(),
    d.stock_movements.toArray(),
  ]);
  const live = batches.filter((b) => !b.deleted_at);
  const liveMoves = movements.filter((m) => !m.deleted_at);
  const v = verifyAgainstCounters(live, liveMoves);
  return {
    ok: v.ok,
    checked: v.rows.length,
    rows: v.rows,
    mismatches: v.mismatches,
    hasMovements: liveMoves.length > 0,
  };
}



export { businessDateOf };
