// পুরোনো রেকর্ড থেকে স্টকের নড়াচড়ার ইতিহাস তৈরি করা।
//
// এখানে কোনো ডেটাবেস নেই — শুধু হিসাব। তাই প্রতিটি নিয়ম আলাদাভাবে
// পরীক্ষা করা যায়, আর মাইগ্রেশনের কোড শুধু এই ফাংশনগুলো ডাকে।
//
// সবচেয়ে গুরুত্বপূর্ণ সূক্ষ্মতা: বাতিল করা লেনদেনগুলো কাউন্টার সরাসরি
// বদলে করা হয়েছিল, উল্টো সারি লিখে নয়। তাই পুরো ইতিহাস অন্ধভাবে যোগ
// করলে ভুল সংখ্যা আসবে — শুধু এখনো সক্রিয় রেকর্ডগুলো ধরতে হবে।

import type { MovementReason, StockMovement } from '@/types/db';

// ---------- ইনপুট: যতটুকু দরকার ততটুকুই ----------

export interface RBatch { id: string; medicine_id: string; qty_in_stock: number; deleted_at?: string | null }
export interface RStockEntry { id: string; batch_id: string; qty: number; entry_date: string; created_at: string; status?: string; deleted_at?: string | null }
export interface RSale { id: string; status: string; sale_date: string; deleted_at?: string | null }
export interface RSaleItem { id: string; sale_id: string; batch_id: string; medicine_id: string; qty: number; deleted_at?: string | null }
export interface RAdjustment { id: string; batch_id: string; qty: number; adjusted_at: string; status?: string; deleted_at?: string | null }
export interface RSaleReturn { id: string; sale_id: string; return_date: string; created_at: string; status?: string; deleted_at?: string | null }
export interface RReturnItem { id: string; return_id: string; batch_id: string; qty: number; restock: boolean; deleted_at?: string | null }

export interface ReconstructInput {
  batches: RBatch[];
  stockEntries: RStockEntry[];
  sales: RSale[];
  saleItems: RSaleItem[];
  adjustments: RAdjustment[];
  returns: RSaleReturn[];
  returnItems: RReturnItem[];
}

/** এক ব্যাচের ফলাফল। */
export interface BatchReconciliation {
  batch_id: string;
  /** ব্যাচে যা লেখা আছে। */
  counter: number;
  /** ইতিহাস থেকে যা বেরোয় (প্রারম্ভিক জের বাদে)। */
  replayed: number;
  /** পার্থক্য — এটিই প্রারম্ভিক জের হিসেবে বসে। */
  opening: number;
}

export interface ReconstructResult {
  movements: BackfillMovement[];
  perBatch: BatchReconciliation[];
  /** যেসব ব্যাচে ইতিহাস মেলেনি, তাই প্রারম্ভিক জের বসাতে হয়েছে। */
  reconciledBatches: string[];
  /** কোনো সময়ে স্টক ঋণাত্মক হয়ে গিয়েছিল — সাজানোর ক্রম ভুল হতে পারে। */
  warnings: string[];
}

/** মাইগ্রেশনে তৈরি সারি। pharmacy_id ও dirty hook বসায়। */
export type BackfillMovement = Omit<StockMovement, 'pharmacy_id' | 'dirty' | 'updated_at' | 'deleted_at'>;

// ---------- সাহায্যকারী ----------

const isLive = (r: { deleted_at?: string | null }) => !r.deleted_at;
const isActive = (r: { status?: string; deleted_at?: string | null }) =>
  isLive(r) && (r.status ?? 'completed') !== 'cancelled';

/** ISO সময় বা তারিখ থেকে স্থানীয় দিনপঞ্জির তারিখ। */
export function businessDateOf(value: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * মাইগ্রেশনের সারির পরিচয় সবসময় একই — তাই দুবার চালালেও দুবার বসে না।
 * (নিয়ম I8)
 */
export function backfillId(refType: string, refId: string): string {
  return `mv-${refType}-${refId}`;
}

// ---------- মূল কাজ ----------

/**
 * সক্রিয় রেকর্ডগুলো থেকে নড়াচড়ার তালিকা তৈরি করে।
 * প্রতিটি ব্যাচে ইতিহাস আর সংরক্ষিত সংখ্যার পার্থক্য প্রারম্ভিক জের
 * হিসেবে বসে, তাই মালিক পর্দায় যা দেখছেন তা এক চুলও বদলায় না (নিয়ম I1)।
 */
export function reconstructMovements(input: ReconstructInput): ReconstructResult {
  const movements: BackfillMovement[] = [];
  const replayed = new Map<string, number>();
  const add = (batchId: string, delta: number) =>
    replayed.set(batchId, (replayed.get(batchId) ?? 0) + delta);

  const medicineOf = new Map(input.batches.map((b) => [b.id, b.medicine_id]));
  const known = new Set(input.batches.filter(isLive).map((b) => b.id));

  const push = (
    batchId: string, delta: number, reason: MovementReason,
    refType: string | null, refId: string | null, when: string, createdAt: string,
  ) => {
    if (!known.has(batchId)) return; // মুছে ফেলা বা অজানা ব্যাচ বাদ
    movements.push({
      id: refType && refId ? backfillId(refType, refId) : backfillId('opening', batchId),
      batch_id: batchId,
      medicine_id: medicineOf.get(batchId) ?? '',
      qty_delta: delta,
      reason,
      ref_type: refType,
      ref_id: refId,
      business_date: businessDateOf(when),
      created_at: createdAt,
      client_txn_id: refType && refId ? backfillId(refType, refId) : backfillId('opening', batchId),
      note: null,
    });
    add(batchId, delta);
  };

  // ১. স্টক ঢুকেছে
  for (const e of input.stockEntries) {
    if (!isActive(e)) continue;
    push(e.batch_id, e.qty, 'purchase', 'stock_entry', e.id, e.entry_date, e.created_at);
  }

  // ২. বিক্রি হয়েছে — শুধু যেসব বিক্রয় এখনো সম্পন্ন
  const liveSale = new Map(input.sales.filter(isLive).map((s) => [s.id, s]));
  for (const it of input.saleItems) {
    if (!isLive(it)) continue;
    const sale = liveSale.get(it.sale_id);
    if (!sale || sale.status !== 'completed') continue;
    push(it.batch_id, -it.qty, 'sale', 'sale_item', it.id, sale.sale_date, sale.sale_date);
  }

  // ৩. সমন্বয় — পরিমাণে চিহ্ন আগে থেকেই আছে
  for (const a of input.adjustments) {
    if (!isActive(a)) continue;
    push(a.batch_id, a.qty, 'adjustment', 'stock_adjustment', a.id, a.adjusted_at, a.adjusted_at);
  }

  // ৪. রিটার্নে স্টকে ফেরত — শুধু restock করা ও এখনো সক্রিয় রিটার্ন
  const activeReturn = new Map(input.returns.filter(isActive).map((r) => [r.id, r]));
  for (const it of input.returnItems) {
    if (!isLive(it) || !it.restock) continue;
    const ret = activeReturn.get(it.return_id);
    if (!ret) continue;
    push(it.batch_id, it.qty, 'return', 'sale_return_item', it.id, ret.return_date, ret.created_at);
  }

  // ৫. পার্থক্য থাকলে প্রারম্ভিক জের — যাতে দেখানো সংখ্যা না বদলায়
  const perBatch: BatchReconciliation[] = [];
  const reconciledBatches: string[] = [];
  for (const b of input.batches) {
    if (!isLive(b)) continue;
    const r = replayed.get(b.id) ?? 0;
    const opening = b.qty_in_stock - r;
    perBatch.push({ batch_id: b.id, counter: b.qty_in_stock, replayed: r, opening });
    if (opening !== 0) {
      reconciledBatches.push(b.id);
      movements.push({
        id: backfillId('opening', b.id),
        batch_id: b.id,
        medicine_id: b.medicine_id,
        qty_delta: opening,
        reason: 'opening_balance',
        ref_type: null,
        ref_id: null,
        business_date: '1970-01-01',
        created_at: '1970-01-01T00:00:00.000Z',
        client_txn_id: backfillId('opening', b.id),
        note: 'অ্যাপ শুরুর আগের বা মেলাতে না পারা পরিমাণ',
      });
    }
  }

  return {
    movements,
    perBatch,
    reconciledBatches,
    warnings: findNegativeDips(movements),
  };
}

/**
 * স্বাধীন যাচাই (নিয়ম I2)।
 * ইচ্ছাকৃতভাবে উপরের হিসাব আবার ব্যবহার করা হয় না — নতুন করে যোগ করা হয়,
 * যাতে হিসাবের ভুল ধরা পড়ে।
 */
export function sumByBatch(movements: { batch_id: string; qty_delta: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) out.set(m.batch_id, (out.get(m.batch_id) ?? 0) + m.qty_delta);
  return out;
}

export interface VerifyRow { batch_id: string; counter: number; computed: number; difference: number }

/** প্রতিটি ব্যাচে নড়াচড়ার যোগফল আর সংরক্ষিত সংখ্যা মেলে কিনা। */
export function verifyAgainstCounters(
  batches: RBatch[],
  movements: { batch_id: string; qty_delta: number }[],
): { ok: boolean; rows: VerifyRow[]; mismatches: VerifyRow[] } {
  const sums = sumByBatch(movements);
  const rows: VerifyRow[] = [];
  for (const b of batches) {
    if (!isLive(b)) continue;
    const computed = sums.get(b.id) ?? 0;
    rows.push({
      batch_id: b.id,
      counter: b.qty_in_stock,
      computed,
      difference: b.qty_in_stock - computed,
    });
  }
  const mismatches = rows.filter((r) => r.difference !== 0);
  return { ok: mismatches.length === 0, rows, mismatches };
}

export interface CacheFix { batch_id: string; from: number; to: number }

/**
 * ব্যাচে লেখা সংখ্যাটিকে নড়াচড়ার যোগফল দিয়ে ঠিক করার পরিকল্পনা।
 *
 * `batches.qty_in_stock` হলো **হিসাব করা সংখ্যা** (cache) — প্রতিটি পর্দায়
 * পুরো ইতিহাস যোগ না করে দ্রুত দেখানোর জন্য। লেখার সময় নড়াচড়া আর এই
 * সংখ্যা একসাথে বসে, তাই স্বাভাবিক অবস্থায় দুটি সমান থাকে। সিঙ্কে অন্য
 * ডিভাইসের নড়াচড়া নামার পর এটিই আবার গুনে নেয়।
 *
 * একটি নিয়ম গুরুত্বপূর্ণ: যে ব্যাচের কোনো নড়াচড়াই নেই, তাকে ছোঁয়া হয় না।
 * নইলে যে ডিভাইসে ইতিহাস তৈরি হয়নি সেখানে সব স্টক শূন্য হয়ে যেত।
 */
export function planCacheRebuild(
  batches: { id: string; qty_in_stock: number; deleted_at?: string | null }[],
  movements: { batch_id: string; qty_delta: number; deleted_at?: string | null }[],
): { checked: number; skipped: number; fixes: CacheFix[] } {
  const sums = sumByBatch(movements.filter(isLive));
  const fixes: CacheFix[] = [];
  let checked = 0;
  let skipped = 0;
  for (const b of batches) {
    if (!isLive(b)) continue;
    if (!sums.has(b.id)) { skipped += 1; continue; }   // ইতিহাস নেই — হাত দেওয়া হয় না
    checked += 1;
    const to = sums.get(b.id)!;
    if (to !== b.qty_in_stock) fixes.push({ batch_id: b.id, from: b.qty_in_stock, to });
  }
  return { checked, skipped, fixes };
}

/**
 * কোনো সময়ে স্টক ঋণাত্মক হয়ে গিয়েছিল কিনা (নিয়ম I6)।
 * দোকান যা পায়নি তা বিক্রি করতে পারে না — তাই ঋণাত্মক মানে সাজানোর ক্রম
 * সম্ভবত ভুল। এটি সতর্কতা, ব্যর্থতা নয়, কারণ পুরোনো সময়ের ক্রম সবসময়
 * নিখুঁতভাবে জানা যায় না।
 */
export function findNegativeDips(movements: BackfillMovement[]): string[] {
  const byBatch = new Map<string, BackfillMovement[]>();
  for (const m of movements) {
    const list = byBatch.get(m.batch_id) ?? [];
    list.push(m);
    byBatch.set(m.batch_id, list);
  }
  const warnings: string[] = [];
  for (const [batchId, list] of byBatch) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    let running = 0;
    let lowest = 0;
    for (const m of sorted) {
      running += m.qty_delta;
      if (running < lowest) lowest = running;
    }
    if (lowest < 0) {
      warnings.push(`batch ${batchId}: ইতিহাসে এক সময় স্টক ${lowest} হয়ে গিয়েছিল`);
    }
  }
  return warnings;
}
