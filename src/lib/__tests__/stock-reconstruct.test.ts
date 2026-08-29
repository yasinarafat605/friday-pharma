import { describe, it, expect } from 'vitest';
import {
  reconstructMovements, verifyAgainstCounters, findNegativeDips, businessDateOf, backfillId,
  type ReconstructInput, type RBatch,
} from '@/lib/stock/reconstruct';

// ---------- fixture তৈরির সাহায্যকারী ----------
const B = (id: string, qty: number): RBatch => ({ id, medicine_id: 'med-' + id, qty_in_stock: qty });

function input(over: Partial<ReconstructInput> = {}): ReconstructInput {
  return {
    batches: [], stockEntries: [], sales: [], saleItems: [],
    adjustments: [], returns: [], returnItems: [], ...over,
  };
}

const entry = (id: string, batch: string, qty: number, status = 'completed') =>
  ({ id, batch_id: batch, qty, entry_date: '2026-08-01', created_at: '2026-08-01T04:00:00.000Z', status });
const sale = (id: string, status = 'completed') =>
  ({ id, status, sale_date: '2026-08-05T06:00:00.000Z' });
const item = (id: string, saleId: string, batch: string, qty: number) =>
  ({ id, sale_id: saleId, batch_id: batch, medicine_id: 'med-' + batch, qty });
const adj = (id: string, batch: string, qty: number, status = 'completed') =>
  ({ id, batch_id: batch, qty, adjusted_at: '2026-08-06T06:00:00.000Z', status });
const ret = (id: string, saleId: string, status = 'completed') =>
  ({ id, sale_id: saleId, return_date: '2026-08-07', created_at: '2026-08-07T06:00:00.000Z', status });
const retItem = (id: string, retId: string, batch: string, qty: number, restock = true) =>
  ({ id, return_id: retId, batch_id: batch, qty, restock });

/** প্রতিটি ক্ষেত্রে মূল দাবিটি: নড়াচড়ার যোগফল = ব্যাচে লেখা সংখ্যা (I2)। */
function expectReconciles(inp: ReconstructInput) {
  const r = reconstructMovements(inp);
  const v = verifyAgainstCounters(inp.batches, r.movements);
  expect(v.mismatches).toEqual([]);
  expect(v.ok).toBe(true);
  return r;
}

describe('I2 — নড়াচড়ার যোগফল ব্যাচের সংখ্যার সমান', () => {
  it('১. শুধু ক্রয়', () => {
    const inp = input({ batches: [B('b1', 100)], stockEntries: [entry('e1', 'b1', 100)] });
    const r = expectReconciles(inp);
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]!.reason).toBe('purchase');
    expect(r.reconciledBatches).toEqual([]);
  });

  it('২. ক্রয়ের পর কিছু বিক্রয়', () => {
    const inp = input({
      batches: [B('b1', 90)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 10)],
    });
    const r = expectReconciles(inp);
    expect(r.movements.map((m) => m.qty_delta)).toEqual([100, -10]);
  });

  it('৩. বিক্রয় হয়ে পরে বাতিল — স্টক ফেরত গেছে, তাই বিক্রয় গোনা হয় না', () => {
    const inp = input({
      batches: [B('b1', 100)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1', 'cancelled')], saleItems: [item('i1', 's1', 'b1', 10)],
    });
    const r = expectReconciles(inp);
    expect(r.movements.filter((m) => m.reason === 'sale')).toHaveLength(0);
    expect(r.reconciledBatches).toEqual([]);
  });

  it('৪. স্টক এন্ট্রি বাতিল', () => {
    const inp = input({
      batches: [B('b1', 0)],
      stockEntries: [entry('e1', 'b1', 50, 'cancelled')],
    });
    const r = expectReconciles(inp);
    expect(r.movements).toHaveLength(0);
  });

  it('৫. এন্ট্রির পরিমাণ পরে বাড়ানো ও কমানো', () => {
    // এন্ট্রির qty ও ব্যাচ একসাথে বদলায়, তাই বর্তমান qty ধরলেই মেলে
    expectReconciles(input({ batches: [B('b1', 120)], stockEntries: [entry('e1', 'b1', 120)] }));
    expectReconciles(input({ batches: [B('b1', 80)], stockEntries: [entry('e1', 'b1', 80)] }));
  });

  it('৬. নষ্টের সমন্বয়, ও বাতিল করা সমন্বয়', () => {
    const active = input({
      batches: [B('b1', 95)],
      stockEntries: [entry('e1', 'b1', 100)],
      adjustments: [adj('a1', 'b1', -5)],
    });
    const r = expectReconciles(active);
    expect(r.movements.find((m) => m.reason === 'adjustment')!.qty_delta).toBe(-5);

    const cancelled = input({
      batches: [B('b1', 100)],
      stockEntries: [entry('e1', 'b1', 100)],
      adjustments: [adj('a1', 'b1', -5, 'cancelled')],
    });
    const r2 = expectReconciles(cancelled);
    expect(r2.movements.filter((m) => m.reason === 'adjustment')).toHaveLength(0);
  });

  it('৭ক. restock করা রিটার্ন স্টকে ফেরে', () => {
    const inp = input({
      batches: [B('b1', 92)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 10)],
      returns: [ret('r1', 's1')], returnItems: [retItem('ri1', 'r1', 'b1', 2, true)],
    });
    const r = expectReconciles(inp);
    expect(r.movements.find((m) => m.reason === 'return')!.qty_delta).toBe(2);
  });

  it('৭খ. restock ছাড়া রিটার্ন স্টকে ফেরে না', () => {
    const inp = input({
      batches: [B('b1', 90)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 10)],
      returns: [ret('r1', 's1')], returnItems: [retItem('ri1', 'r1', 'b1', 2, false)],
    });
    const r = expectReconciles(inp);
    expect(r.movements.filter((m) => m.reason === 'return')).toHaveLength(0);
  });

  it('৭গ. বাতিল করা রিটার্ন গোনা হয় না', () => {
    const inp = input({
      batches: [B('b1', 90)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 10)],
      returns: [ret('r1', 's1', 'cancelled')], returnItems: [retItem('ri1', 'r1', 'b1', 2, true)],
    });
    const r = expectReconciles(inp);
    expect(r.movements.filter((m) => m.reason === 'return')).toHaveLength(0);
  });

  it('৮. ব্যাচ আছে কিন্তু কোনো স্টক ঢোকেনি', () => {
    const r = expectReconciles(input({ batches: [B('b1', 0)] }));
    expect(r.movements).toHaveLength(0);
  });

  it('৯. ইতিহাস না মিললে প্রারম্ভিক জের বসে, দেখানো সংখ্যা বদলায় না', () => {
    // ব্যাচে ১২০ লেখা, ইতিহাসে মাত্র ১০০ — ২০ ঘাটতি
    const inp = input({ batches: [B('b1', 120)], stockEntries: [entry('e1', 'b1', 100)] });
    const r = expectReconciles(inp);
    const opening = r.movements.find((m) => m.reason === 'opening_balance');
    expect(opening).toBeDefined();
    expect(opening!.qty_delta).toBe(20);
    expect(r.reconciledBatches).toEqual(['b1']);
  });

  it('১০. এক বিক্রয়ে দুটি রিটার্ন, একটি বাতিল — QC-তে পাওয়া বাগের আকৃতি', () => {
    const inp = input({
      batches: [B('b1', 93)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 10)],
      returns: [ret('r1', 's1'), ret('r2', 's1', 'cancelled')],
      returnItems: [retItem('ri1', 'r1', 'b1', 3, true), retItem('ri2', 'r2', 'b1', 2, true)],
    });
    const r = expectReconciles(inp);
    const returns = r.movements.filter((m) => m.reason === 'return');
    expect(returns).toHaveLength(1);
    expect(returns[0]!.qty_delta).toBe(3);
  });
});

describe('I4 — কোনো রেকর্ড হারায় না, বানানোও হয় না', () => {
  const inp = input({
    batches: [B('b1', 93), B('b2', 20)],
    stockEntries: [entry('e1', 'b1', 100), entry('e2', 'b2', 20), entry('e3', 'b1', 5, 'cancelled')],
    sales: [sale('s1'), sale('s2', 'cancelled')],
    saleItems: [item('i1', 's1', 'b1', 10), item('i2', 's2', 'b1', 7)],
    adjustments: [adj('a1', 'b1', -5), adj('a2', 'b1', -3, 'cancelled')],
    returns: [ret('r1', 's1')],
    returnItems: [retItem('ri1', 'r1', 'b1', 3, true), retItem('ri2', 'r1', 'b1', 1, false)],
  });

  it('প্রতিটি সক্রিয় রেকর্ডের একটি করে নড়াচড়া', () => {
    const r = reconstructMovements(inp);
    const count = (reason: string) => r.movements.filter((m) => m.reason === reason).length;
    expect(count('purchase')).toBe(2);    // e3 বাতিল
    expect(count('sale')).toBe(1);        // i2-র বিক্রয় বাতিল
    expect(count('adjustment')).toBe(1);  // a2 বাতিল
    expect(count('return')).toBe(1);      // ri2 restock নয়
  });

  it('প্রতিটি নড়াচড়া আসল রেকর্ডে ফিরে যায়', () => {
    const r = reconstructMovements(inp);
    const ids = {
      stock_entry: new Set(inp.stockEntries.map((x) => x.id)),
      sale_item: new Set(inp.saleItems.map((x) => x.id)),
      stock_adjustment: new Set(inp.adjustments.map((x) => x.id)),
      sale_return_item: new Set(inp.returnItems.map((x) => x.id)),
    } as Record<string, Set<string>>;
    for (const m of r.movements) {
      if (m.reason === 'opening_balance') { expect(m.ref_id).toBeNull(); continue; }
      expect(ids[m.ref_type!]!.has(m.ref_id!)).toBe(true);
    }
  });

  it('দুটি ব্যাচই আলাদাভাবে মেলে', () => {
    const r = reconstructMovements(inp);
    const v = verifyAgainstCounters(inp.batches, r.movements);
    expect(v.ok).toBe(true);
    expect(v.rows).toHaveLength(2);
  });
});

describe('I2 যাচাই ভুল ধরতে পারে', () => {
  it('নড়াচড়া কম থাকলে যাচাই ব্যর্থ হয়', () => {
    const v = verifyAgainstCounters([B('b1', 100)], [{ batch_id: 'b1', qty_delta: 90 }]);
    expect(v.ok).toBe(false);
    expect(v.mismatches[0]!.difference).toBe(10);
  });

  it('কোনো নড়াচড়াই না থাকলে ধরা পড়ে', () => {
    const v = verifyAgainstCounters([B('b1', 50)], []);
    expect(v.ok).toBe(false);
    expect(v.mismatches[0]!.computed).toBe(0);
  });
});

describe('I6 — ইতিহাসে ঋণাত্মক স্টক ধরা পড়ে', () => {
  it('আগে বিক্রয় পরে ক্রয় হলে সতর্কতা আসে', () => {
    const w = findNegativeDips([
      { batch_id: 'b1', qty_delta: -5, created_at: '2026-08-01T00:00:00Z' },
      { batch_id: 'b1', qty_delta: 10, created_at: '2026-08-02T00:00:00Z' },
    ] as never);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('b1');
  });

  it('স্বাভাবিক ক্রমে কোনো সতর্কতা নেই', () => {
    const w = findNegativeDips([
      { batch_id: 'b1', qty_delta: 10, created_at: '2026-08-01T00:00:00Z' },
      { batch_id: 'b1', qty_delta: -5, created_at: '2026-08-02T00:00:00Z' },
    ] as never);
    expect(w).toEqual([]);
  });
});

describe('I8 — দুবার চালালেও একই', () => {
  it('একই রেকর্ড থেকে সবসময় একই পরিচয় তৈরি হয়', () => {
    expect(backfillId('sale_item', 'i1')).toBe('mv-sale_item-i1');
    const inp = input({ batches: [B('b1', 100)], stockEntries: [entry('e1', 'b1', 100)] });
    const a = reconstructMovements(inp).movements.map((m) => m.id);
    const b = reconstructMovements(inp).movements.map((m) => m.id);
    expect(a).toEqual(b);
  });
});

describe('তারিখ', () => {
  it('ISO সময় স্থানীয় তারিখে নামে', () => {
    expect(businessDateOf(new Date(2026, 7, 28, 1, 0).toISOString())).toBe('2026-08-28');
  });
  it('আগে থেকেই তারিখ হলে অক্ষত থাকে', () => {
    expect(businessDateOf('2026-08-15')).toBe('2026-08-15');
  });
});

// ============================================================
// I3 — মিল না হলে মাইগ্রেশন থামে
// ============================================================
import { independentReplay, crossCheckReplay } from '@/lib/stock/backfill';

describe('I3 — দুই পথে হিসাব মিলিয়ে দেখা', () => {
  const inp = input({
    batches: [B('b1', 88), B('b2', 20)],
    stockEntries: [entry('e1', 'b1', 100), entry('e2', 'b2', 20), entry('e3', 'b1', 7, 'cancelled')],
    sales: [sale('s1'), sale('s2', 'cancelled')],
    saleItems: [item('i1', 's1', 'b1', 10), item('i2', 's2', 'b1', 3)],
    adjustments: [adj('a1', 'b1', -5), adj('a2', 'b1', -4, 'cancelled')],
    returns: [ret('r1', 's1'), ret('r2', 's1', 'cancelled')],
    returnItems: [retItem('ri1', 'r1', 'b1', 3, true), retItem('ri2', 'r2', 'b1', 2, true)],
  });

  it('স্বাধীন হিসাব মূল হিসাবের সাথে মেলে', () => {
    const r = reconstructMovements(inp);
    const other = independentReplay(inp);
    expect(crossCheckReplay(r.perBatch, other).ok).toBe(true);
    // 100 − 10 − 5 + 3 = 88
    expect(other.get('b1')).toBe(88);
    expect(other.get('b2')).toBe(20);
  });

  it('ইতিহাস তৈরিতে ভুল হলে ধরা পড়ে — এটাই থামার শর্ত', () => {
    const r = reconstructMovements(inp);
    // যেন বিক্রয়ের চিহ্ন উল্টো বসেছে: replayed ভুল হবে
    const broken = r.perBatch.map((row) =>
      row.batch_id === 'b1' ? { ...row, replayed: row.replayed + 20 } : row);
    const check = crossCheckReplay(broken, independentReplay(inp));
    expect(check.ok).toBe(false);
    expect(check.disagreements[0]!.batch_id).toBe('b1');
  });

  it('একটি রেকর্ড হারিয়ে গেলেও ধরা পড়ে', () => {
    const r = reconstructMovements(inp);
    const withoutOneSale = independentReplay({ ...inp, saleItems: [] });
    expect(crossCheckReplay(r.perBatch, withoutOneSale).ok).toBe(false);
  });

  it('প্রারম্ভিক জের ভুল ঢাকতে পারে না', () => {
    // মূল দুর্বলতা: জের = লেখা − ইতিহাস, তাই ইতিহাস ভুল হলেও যোগফল মিলে যেত।
    // দুই পথে মেলানোয় সেটি আর সম্ভব নয়।
    const wrongSign = input({
      batches: [B('b1', 88)],
      stockEntries: [entry('e1', 'b1', 100)],
      sales: [sale('s1')], saleItems: [item('i1', 's1', 'b1', 12)],
    });
    const r = reconstructMovements(wrongSign);
    const v = verifyAgainstCounters(wrongSign.batches, r.movements);
    expect(v.ok).toBe(true);                       // যোগফল মিলে যায়
    expect(crossCheckReplay(r.perBatch, independentReplay(wrongSign)).ok).toBe(true);
    expect(r.perBatch[0]!.replayed).toBe(88);      // 100 − 12
    expect(r.perBatch[0]!.opening).toBe(0);        // কোনো জের লাগেনি
  });
});
