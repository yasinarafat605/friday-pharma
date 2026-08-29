// পুরোনো রেকর্ড থেকে স্টকের ইতিহাস তৈরির মাইগ্রেশন।
//
// এই ফাইলটি ইচ্ছাকৃতভাবে local.ts থেকে কিছুই আনে না — শুধু খাঁটি হিসাব
// (reconstruct.ts) আর Dexie-র transaction। কারণ local.ts নিজেই এটিকে
// ডাকে; দুই দিক থেকে আনা-নেওয়া হলে চক্র তৈরি হতো, যা bundler সামলে
// নিলেও ভঙ্গুর থাকত।

import type { Transaction } from 'dexie';
import {
  reconstructMovements, verifyAgainstCounters,
  type ReconstructInput, type VerifyRow,
} from '@/lib/stock/reconstruct';

/**
 * একই হিসাব, কিন্তু ইচ্ছাকৃতভাবে অন্যভাবে লেখা।
 *
 * কেন দরকার: প্রারম্ভিক জের = লেখা সংখ্যা − ইতিহাস। তাই ইতিহাস তৈরিতে ভুল
 * থাকলেও জেরটি সেই ভুল ঢেকে দিত এবং যোগফল মিলে যেত। দুটি আলাদা পথে হিসাব
 * করে মিলিয়ে দেখলে সেই ভুল ধরা পড়ে।
 *
 * এটিকে reconstruct.ts-এর সাথে "একই রকম" করে লেখা যাবে না — আলাদা হওয়াই
 * এর কাজ।
 */
export function independentReplay(input: ReconstructInput): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (batchId: string, n: number) => out.set(batchId, (out.get(batchId) ?? 0) + n);
  const live = (r: { deleted_at?: string | null }) => !r.deleted_at;
  const usable = new Set(input.batches.filter(live).map((b) => b.id));

  for (const b of input.batches) if (live(b)) out.set(b.id, 0);

  for (const e of input.stockEntries) {
    if (!live(e) || e.status === 'cancelled' || !usable.has(e.batch_id)) continue;
    bump(e.batch_id, Number(e.qty));
  }
  const completedSales = new Set(
    input.sales.filter((x) => live(x) && x.status === 'completed').map((x) => x.id),
  );
  for (const it of input.saleItems) {
    if (!live(it) || !completedSales.has(it.sale_id) || !usable.has(it.batch_id)) continue;
    bump(it.batch_id, 0 - Number(it.qty));
  }
  for (const a of input.adjustments) {
    if (!live(a) || a.status === 'cancelled' || !usable.has(a.batch_id)) continue;
    bump(a.batch_id, Number(a.qty));
  }
  const okReturns = new Set(
    input.returns.filter((x) => live(x) && x.status !== 'cancelled').map((x) => x.id),
  );
  for (const it of input.returnItems) {
    if (!live(it) || !it.restock || !okReturns.has(it.return_id) || !usable.has(it.batch_id)) continue;
    bump(it.batch_id, Number(it.qty));
  }
  return out;
}

/** দুই পথের হিসাব মেলে কিনা। না মিললে ইতিহাস তৈরিতেই ভুল আছে। */
export function crossCheckReplay(
  perBatch: { batch_id: string; replayed: number }[],
  independent: Map<string, number>,
): { ok: boolean; disagreements: { batch_id: string; a: number; b: number }[] } {
  const disagreements: { batch_id: string; a: number; b: number }[] = [];
  for (const row of perBatch) {
    const other = independent.get(row.batch_id) ?? 0;
    if (other !== row.replayed) {
      disagreements.push({ batch_id: row.batch_id, a: row.replayed, b: other });
    }
  }
  return { ok: disagreements.length === 0, disagreements };
}

export class BackfillAbort extends Error {
  constructor(message: string, readonly mismatches: VerifyRow[]) {
    super(message);
    this.name = 'BackfillAbort';
  }
}

/**
 * upgrade transaction-এর ভেতর থেকে ডাকা হয়।
 *
 * ১. আগে থেকে নড়াচড়া থাকলে কিছুই করে না (নিয়ম I8 — দুবার চললেও একই)।
 * ২. সক্রিয় রেকর্ড থেকে ইতিহাস তৈরি করে।
 * ৩. স্বাধীনভাবে যোগ করে মিলিয়ে দেখে।
 * ৪. না মিললে ছুঁড়ে দেয় — Dexie পুরো transaction বাতিল করে, তাই
 *    schema পুরোনো version-এই থাকে আর কাউন্টারই সত্যের উৎস থাকে (নিয়ম I3)।
 */
export async function runBackfillInTransaction(tx: Transaction): Promise<{
  created: number;
  reconciled: string[];
  warnings: string[];
  skipped: boolean;
}> {
  const existing = await tx.table('stock_movements').count();
  if (existing > 0) {
    return { created: 0, reconciled: [], warnings: [], skipped: true };
  }

  const read = async <T>(name: string): Promise<T[]> => {
    try { return (await tx.table(name).toArray()) as T[]; } catch { return []; }
  };

  const input: ReconstructInput = {
    batches: await read('batches'),
    stockEntries: await read('stock_entries'),
    sales: await read('sales'),
    saleItems: await read('sale_items'),
    adjustments: await read('stock_adjustments'),
    returns: await read('sale_returns'),
    returnItems: await read('sale_return_items'),
  };

  const result = reconstructMovements(input);

  // যাচাই ১ — দুই আলাদা পথে ইতিহাস হিসাব করে মেলানো (নিয়ম I3)।
  // এটিই ইতিহাস তৈরির ভুল ধরে, কারণ প্রারম্ভিক জের সেই ভুল ঢেকে দিতে পারত।
  const cross = crossCheckReplay(result.perBatch, independentReplay(input));
  if (!cross.ok) {
    const first = cross.disagreements.slice(0, 3)
      .map((d) => `${d.batch_id}: ${d.a} বনাম ${d.b}`)
      .join('; ');
    throw new BackfillAbort(
      `স্টকের ইতিহাস দুই পথে আলাদা এল (${cross.disagreements.length} টি ব্যাচ) — ${first}`,
      cross.disagreements.map((d) => ({
        batch_id: d.batch_id, counter: d.a, computed: d.b, difference: d.a - d.b,
      })),
    );
  }

  // যাচাই ২ — লেখা সারিগুলো নতুন করে যোগ করে ব্যাচের সংখ্যার সাথে মেলানো
  const check = verifyAgainstCounters(input.batches, result.movements);
  if (!check.ok) {
    const first = check.mismatches.slice(0, 3)
      .map((m) => `${m.batch_id}: লেখা ${m.counter}, হিসাব ${m.computed}`)
      .join('; ');
    throw new BackfillAbort(
      `স্টকের হিসাব মেলেনি (${check.mismatches.length} টি ব্যাচ) — ${first}`,
      check.mismatches,
    );
  }

  if (result.movements.length > 0) {
    await tx.table('stock_movements').bulkAdd(result.movements);
  }

  return {
    created: result.movements.length,
    reconciled: result.reconciledBatches,
    warnings: result.warnings,
    skipped: false,
  };
}
