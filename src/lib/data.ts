'use client';

// অ্যাপের ডেটা স্তর — সম্পূর্ণ local (IndexedDB via Dexie)।
// সব ব্যবসায়িক নিয়ম ও আর্থিক হিসাব এখানে transaction-এ enforce হয় (Section ১৮)।
import type { Table } from 'dexie';
import {
  db, uuid, nowISO, todayISO, localDateOf, newClientTxnId, newTxnNo, audit, ensureSeeded, getSettings,
} from '@/lib/db/local';
import { isExpired, thresholdFor } from '@/lib/business-rules';
import { toBanglaDigits } from '@/lib/money';
import { buildMovement, computeAllBatchQty } from '@/lib/stock/movements';

/**
 * স্টকের পরিমাণ কোথা থেকে পড়া হবে।
 *
 * 'movements' — নড়াচড়ার যোগফল (স্বাভাবিক)।
 * 'counter'   — ব্যাচে লেখা পুরোনো সংখ্যা।
 *
 * নড়াচড়ায় সমস্যা দেখা দিলে এই একটি শব্দ বদলে পুরোনো আচরণে ফেরা যায়।
 * কাউন্টার এখনো প্রতিটি লেখায় হালনাগাদ হয়, তাই সেটি সঠিকই থাকে।
 * এটিই P2-র rollback ব্যবস্থা — তাই কাউন্টার সরানো যাবে না।
 */
const STOCK_SOURCE: 'movements' | 'counter' = 'movements';
import type {
  StockRow, Customer, SaleItemInput, AdjustmentReason, Medicine, MedicineBatch,
  MedicineType, UnitType, AppSettings, ExpenseCategory, Expense,
  CustomerLedger, DuePayment, StockEntry, StockAdjustment, SaleReturn,
  ExpenseSource,
} from '@/types/db';

/** সংরক্ষিত ISO সময় → স্থানীয় দিনপঞ্জির তারিখ (দিন শুরু হয় স্থানীয় মধ্যরাতে)। */
function dateOf(iso: string): string {
  return localDateOf(iso);
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + (b || 0), 0);
}
/** নাম ও পাওয়ার মিলে একটি ওষুধকে আলাদা করে — Napa 500 আর Napa 665 ভিন্ন। */
function sameMedicineKey(
  a: { name: string; strength?: string | null },
  b: { name: string; strength?: string | null },
): boolean {
  const key = (x: { name: string; strength?: string | null }) =>
    `${x.name.trim().toLowerCase()}|${(x.strength ?? '').trim().toLowerCase()}`;
  return key(a) === key(b);
}

/**
 * মুছে ফেলা রেকর্ড সত্যিই মোছা হয় না — চিহ্ন দেওয়া হয়।
 * এতে মুছে ফেলার খবরটিও সার্ভার হয়ে অন্য ডিভাইসে পৌঁছাতে পারে।
 */
function markDeleted<T extends { id: string }>(
  table: { update: (id: string, changes: Record<string, unknown>) => Promise<number> },
  id: string,
): Promise<number> {
  return table.update(id, { deleted_at: nowISO() });
}

/** মুছে ফেলা চিহ্ন নেই এমন রেকর্ড। */
function isLive(row: { deleted_at?: string | null }): boolean {
  return !row.deleted_at;
}

/** টেবিলের সব জীবিত (মুছে ফেলা নয়) রেকর্ড। */
async function liveArray<T extends { deleted_at?: string | null }>(
  table: Table<T, string>,
): Promise<T[]> {
  return (await table.toArray()).filter(isLive);
}

/** পুরোনো রেকর্ডে status নেই — সেগুলো completed ধরা হয়। */
function isActive(row: { status?: string }): boolean {
  return (row.status ?? 'completed') !== 'cancelled';
}

// ============================================================
// STOCK ROWS (medicines + batches + threshold/status)
// ============================================================
export async function fetchStockRows(): Promise<StockRow[]> {
  await ensureSeeded();
  const d = db();
  const [meds, batches, settings] = await Promise.all([
    liveArray(d.medicines),
    liveArray(d.batches),
    getSettings(),
  ]);
  const medMap = new Map(meds.map((m) => [m.id, m]));
  // নড়াচড়া থেকে হিসাব করা পরিমাণ। যে ব্যাচে কোনো নড়াচড়া নেই (যেমন
  // মাইগ্রেশন হয়নি এমন ডিভাইস) সেখানে ব্যাচের নিজের সংখ্যাই ব্যবহার হয়।
  const computed = STOCK_SOURCE === 'movements' ? await computeAllBatchQty() : new Map<string, number>();
  const today = new Date();
  const rows: StockRow[] = [];
  for (const b of batches) {
    const m = medMap.get(b.medicine_id);
    if (!m || !m.is_active) continue;
    const qty = computed.has(b.id) ? computed.get(b.id)! : b.qty_in_stock;
    const th = m.low_stock_threshold ?? typeThreshold(m.type, settings);
    const status: StockRow['stock_status'] =
      qty <= 0 ? 'out' : qty <= th ? 'low' : 'normal';
    rows.push({
      batch_id: b.id, medicine_id: m.id, name: m.name, bn_name: m.bn_name,
      strength: m.strength ?? null,
      generic_name: m.generic_name, company: m.company, type: m.type, unit: m.unit,
      batch_no: b.batch_no, expiry_date: b.expiry_date, qty_in_stock: qty,
      purchase_price_paisa: b.purchase_price_paisa, sale_price_paisa: b.sale_price_paisa,
      threshold: th, stock_status: status, expiry_status: expiryTag(b.expiry_date, today),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function typeThreshold(type: MedicineType, s: AppSettings): number {
  if (type === 'syrup') return s.low_stock_syrup;
  if (type === 'tablet') return s.low_stock_tablet;
  if (type === 'capsule') return s.low_stock_capsule;
  return 5;
}
function expiryTag(expiry: string | null | undefined, today: Date): string | null {
  if (!expiry) return null;
  const days = Math.floor((new Date(expiry + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'ok';
}

// ============================================================
// READS
// ============================================================
export async function fetchMedicines(): Promise<Medicine[]> {
  await ensureSeeded();
  const meds = await db().medicines.filter((m) => isLive(m) && m.is_active).toArray();
  meds.sort((a, b) => a.name.localeCompare(b.name));
  return meds;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const cs = await liveArray(db().customers);
  cs.sort((a, b) => a.name.localeCompare(b.name));
  return cs;
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  await ensureSeeded();
  const cats = await liveArray(db().expense_categories);
  cats.sort((a, b) => a.sort_order - b.sort_order);
  return cats;
}

export async function fetchRecentExpenses(limit = 10): Promise<Expense[]> {
  const all = await db().expenses.filter((e) => e.status === 'completed').toArray();
  all.sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  return all.slice(0, limit);
}

export async function fetchSettings(): Promise<AppSettings> {
  return getSettings();
}
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const cur = await getSettings();
  await db().settings.put({ ...cur, ...patch, id: 'app' });
  await audit('settings', 'app', 'update', patch);
}

/** সফল ব্যাকআপের পর তারিখ রেকর্ড হয় — ড্যাশবোর্ডের সতর্কতা এখান থেকে হিসাব হয়। */
export async function markBackupTaken(at: string = nowISO()): Promise<void> {
  await saveSettings({ last_backup_at: at });
}

// ============================================================
// DASHBOARD
// ============================================================
export interface DashboardStats {
  todaySalesPaisa: number;
  todayCashPaisa: number;
  todayDuePaisa: number;
  todayCollectionPaisa: number;
  todayExpensePaisa: number;
  /** বিক্রয় − বিক্রীত মালের ক্রয়মূল্য (রিটার্ন বাদ দিয়ে)। */
  todayGrossProfitPaisa: number;
  /** মোট লাভ − আজকের খরচ। */
  todayProfitPaisa: number;
  totalDuePaisa: number;
  stockValuePaisa: number;
  lowStockCount: number;
  expiringCount: number;
  expiredCount: number;
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const today = todayISO();
  const d = db();
  const [sales, payments, expenses, customers, rows] = await Promise.all([
    d.sales.filter((s) => s.status === 'completed' && dateOf(s.sale_date) === today).toArray(),
    d.due_payments.filter((p) => p.status === 'completed' && p.pay_date === today).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && e.expense_date === today).toArray(),
    liveArray(d.customers),
    fetchStockRows(),
  ]);
  const saleIds = new Set(sales.map((s) => s.id));
  const [items, ret] = await Promise.all([
    d.sale_items.filter((i) => saleIds.has(i.sale_id)).toArray(),
    returnTotals((dt) => dt === today),
  ]);
  const todaySales = sum(sales.map((s) => s.total_paisa)) - ret.value_paisa;
  const todayExpense = sum(expenses.map((e) => e.amount_paisa));
  // লাভ = বিক্রয়মূল্য − বিক্রীত মালের ক্রয়মূল্য। আগে ক্রয়মূল্য বাদ যেত না, তাই লাভ অনেক বেশি দেখাত।
  const grossProfit = sum(items.map((i) => i.line_total_paisa - Math.round(i.cost_price_paisa * i.qty)))
    - (ret.value_paisa - ret.restocked_cost_paisa);
  return {
    todaySalesPaisa: todaySales,
    todayCashPaisa: sum(sales.map((s) => s.cash_paid_paisa)),
    todayDuePaisa: sum(sales.map((s) => s.due_paisa)),
    todayCollectionPaisa: sum(payments.map((p) => p.amount_paisa)),
    todayExpensePaisa: todayExpense,
    todayGrossProfitPaisa: grossProfit,
    todayProfitPaisa: grossProfit - todayExpense,
    totalDuePaisa: sum(customers.map((c) => c.current_due_paisa)),
    stockValuePaisa: sum(rows.map((r) => Math.round(r.qty_in_stock * r.purchase_price_paisa))),
    lowStockCount: rows.filter((r) => r.stock_status === 'low' || r.stock_status === 'out').length,
    expiringCount: rows.filter((r) => ['d30', 'd60', 'd90'].includes(r.expiry_status ?? '')).length,
    expiredCount: rows.filter((r) => r.expiry_status === 'expired').length,
  };
}

// ============================================================
// CUSTOMER helpers
// ============================================================
async function recomputeCustomerDue(customerId: string): Promise<void> {
  const d = db();
  const ledger = (await d.customer_ledger.where('customer_id').equals(customerId).toArray()).filter(isLive);
  const due = sum(ledger.map((l) => l.amount_paisa));
  const c = await d.customers.get(customerId);
  if (c) {
    await d.customers.put({
      ...c,
      current_due_paisa: due,
      last_txn_date: todayISO(),
    });
  }
}

export async function upsertMedicine(input: {
  name: string; bn_name?: string | null; strength?: string | null;
  generic_name?: string | null;
  company?: string | null; type: MedicineType; unit: UnitType;
  low_stock_threshold?: number | null; note?: string | null;
}): Promise<Medicine> {
  if (!input.name?.trim()) throw new Error('ওষুধের নাম দিন');
  const med: Medicine = {
    id: uuid(),
    name: input.name.trim(),
    bn_name: input.bn_name ?? null,
    strength: input.strength?.trim() || null,
    generic_name: input.generic_name ?? null,
    company: input.company ?? null,
    type: input.type,
    unit: input.unit,
    low_stock_threshold: input.low_stock_threshold ?? null,
    note: input.note ?? null,
    is_active: true,
  };
  const dup = await db().medicines
    .filter((m) => sameMedicineKey(m, med))
    .first();
  if (dup) throw new Error('এই নাম ও পাওয়ারে আগেই একটি ওষুধ আছে');
  await db().medicines.add(med);
  await audit('medicine', med.id, 'create', { name: med.name });
  return med;
}

// ============================================================
// MEDICINE ও BATCH ব্যবস্থাপনা (সংশোধন — audit সহ)
// ============================================================

/** সক্রিয় ও বন্ধ — সব ওষুধ (ব্যবস্থাপনা পেজের জন্য)। */
export async function fetchAllMedicines(): Promise<Medicine[]> {
  await ensureSeeded();
  const meds = await liveArray(db().medicines);
  meds.sort((a, b) => a.name.localeCompare(b.name));
  return meds;
}

/** এক ওষুধের সব batch, মেয়াদ অনুসারে (আগে শেষ হবে যেটি, আগে)। */
export async function fetchBatchesForMedicine(medicineId: string): Promise<MedicineBatch[]> {
  const bs = (await db().batches.where('medicine_id').equals(medicineId).toArray()).filter(isLive);
  bs.sort((a, b) => (a.expiry_date ?? '9999-12-31').localeCompare(b.expiry_date ?? '9999-12-31'));
  return bs;
}

/** ওষুধের তথ্য সংশোধন। নাম ফাঁকা বা ডুপ্লিকেট হলে বাতিল; পুরোনো মান audit-এ থাকে। */
export async function updateMedicine(id: string, patch: {
  name?: string; bn_name?: string | null; strength?: string | null;
  generic_name?: string | null;
  company?: string | null; type?: MedicineType; unit?: UnitType;
  low_stock_threshold?: number | null; note?: string | null;
}): Promise<Medicine> {
  const d = db();
  const cur = await d.medicines.get(id);
  if (!cur) throw new Error('ওষুধ পাওয়া যায়নি');
  const name = (patch.name ?? cur.name).trim();
  if (!name) throw new Error('ওষুধের নাম দিন');
  const strength = patch.strength === undefined ? (cur.strength ?? null) : (patch.strength?.trim() || null);
  const clash = await d.medicines
    .filter((m) => m.id !== id && sameMedicineKey(m, { name, strength }))
    .first();
  if (clash) throw new Error('এই নাম ও পাওয়ারে আরেকটি ওষুধ আছে');
  const th = patch.low_stock_threshold;
  if (th != null && (!Number.isFinite(th) || th < 0)) {
    throw new Error('কম স্টকের সীমা ০ বা তার বেশি হতে হবে');
  }
  const next: Medicine = { ...cur, ...patch, name, strength };
  await d.medicines.put(next);
  await audit('medicine', id, 'update', next, cur);
  return next;
}

/** ওষুধ বন্ধ বা চালু। বন্ধ হলে বিক্রয় ও স্টক তালিকায় আসে না, রেকর্ড মুছে যায় না। */
export async function setMedicineActive(id: string, active: boolean): Promise<{ remaining_qty: number }> {
  const d = db();
  const cur = await d.medicines.get(id);
  if (!cur) throw new Error('ওষুধ পাওয়া যায়নি');
  const batches = (await d.batches.where('medicine_id').equals(id).toArray()).filter(isLive);
  const remaining = sum(batches.map((b) => b.qty_in_stock));
  await d.medicines.put({ ...cur, is_active: active });
  await audit('medicine', id, active ? 'activate' : 'deactivate',
    { is_active: active, remaining_qty: remaining }, { is_active: cur.is_active });
  return { remaining_qty: remaining };
}

/** batch-এর ভুল দাম, batch নম্বর বা মেয়াদ সংশোধন। পরিমাণ এখানে বদলানো যায় না — স্টক সমন্বয় ব্যবহার করুন। */
export async function updateBatch(batchId: string, patch: {
  batch_no?: string | null; expiry_date?: string | null;
  purchase_price_paisa?: number; sale_price_paisa?: number;
}): Promise<MedicineBatch> {
  const d = db();
  const cur = await d.batches.get(batchId);
  if (!cur) throw new Error('batch পাওয়া যায়নি');
  const purchase = patch.purchase_price_paisa ?? cur.purchase_price_paisa;
  const sale = patch.sale_price_paisa ?? cur.sale_price_paisa;
  if (!Number.isFinite(purchase) || purchase < 0) throw new Error('ক্রয়মূল্য ০ বা তার বেশি হতে হবে');
  if (!Number.isFinite(sale) || sale < 0) throw new Error('বিক্রয়মূল্য ০ বা তার বেশি হতে হবে');
  const batchNo = patch.batch_no === undefined ? cur.batch_no : (patch.batch_no || null);
  const clash = await d.batches
    .where('medicine_id').equals(cur.medicine_id)
    .filter((b) => b.id !== batchId && (b.batch_no ?? '') === (batchNo ?? ''))
    .first();
  if (clash) throw new Error('এই ওষুধে একই batch নম্বর আগেই আছে');
  const next: MedicineBatch = {
    ...cur,
    batch_no: batchNo,
    expiry_date: patch.expiry_date === undefined ? cur.expiry_date : (patch.expiry_date || null),
    purchase_price_paisa: Math.round(purchase),
    sale_price_paisa: Math.round(sale),
  };
  await d.batches.put(next);
  await audit('batch', batchId, 'update', next, cur);
  return next;
}

export async function upsertCustomer(input: {
  name: string; phone?: string | null; village?: string | null; note?: string | null;
  /** অ্যাপ ব্যবহারের আগের পুরোনো বকেয়া, ঐচ্ছিক। */
  opening_due_paisa?: number;
}): Promise<Customer> {
  if (!input.name?.trim()) throw new Error('নাম দিন');
  const opening = Math.round(input.opening_due_paisa ?? 0);
  if (opening < 0) throw new Error('পূর্বের বকেয়া negative হতে পারবে না');
  const c: Customer = {
    id: uuid(),
    name: input.name.trim(),
    phone: input.phone ?? null,
    village: input.village ?? null,
    note: input.note ?? null,
    first_due_date: opening > 0 ? todayISO() : null,
    last_txn_date: null,
    current_due_paisa: opening,
  };
  await db().customers.add(c);
  if (opening > 0) {
    await db().customer_ledger.add({
      id: uuid(), customer_id: c.id, entry_type: 'opening',
      amount_paisa: opening, note: 'অ্যাপ শুরুর আগের বকেয়া', entry_date: nowISO(),
    });
  }
  await audit('customer', c.id, 'create', { name: c.name, opening_due_paisa: opening });
  return c;
}

// ============================================================
// SALE (FEFO, expiry, stock, ledger, cash) — নিয়ম ১,২,৭,৯,১৩,১৫
// ============================================================
export async function createSale(input: {
  customer_id?: string | null;
  discount_paisa: number;
  payment_type: 'cash' | 'due' | 'mixed';
  cash_paid_paisa: number;
  items: SaleItemInput[];
  note?: string | null;
}) {
  if (input.items.length === 0) throw new Error('অন্তত একটি ওষুধ নির্বাচন করুন');
  const d = db();
  const saleId = uuid();
  const client_txn_id = newClientTxnId('sale');
  const txn_no = newTxnNo();
  const discount = Math.max(0, Math.round(input.discount_paisa || 0));

  return d.transaction('rw',
    [d.stock_movements, d.sales, d.sale_items, d.batches, d.customers, d.customer_ledger, d.audit_logs],
    async () => {
      let subtotal = 0;
      const itemRows = [];
      for (const it of input.items) {
        const batch = await d.batches.get(it.batch_id);
        if (!batch) throw new Error('batch পাওয়া যায়নি');
        if (isExpired(batch.expiry_date)) {
          throw new Error(`মেয়াদোত্তীর্ণ ওষুধ বিক্রি করা যাবে না (ব্যাচ ${batch.batch_no ?? '—'})`);
        }
        if (batch.qty_in_stock < it.qty) {
          throw new Error(`স্টকে যথেষ্ট নেই (আছে ${toBanglaDigits(batch.qty_in_stock)}, চাওয়া ${toBanglaDigits(it.qty)})`);
        }
        const line = Math.round(it.unit_price_paisa * it.qty);
        subtotal += line;
        itemRows.push({
          id: uuid(), sale_id: saleId, medicine_id: it.medicine_id, batch_id: batch.id,
          qty: it.qty, unit_price_paisa: it.unit_price_paisa,
          cost_price_paisa: batch.purchase_price_paisa, line_total_paisa: line,
        });
        await d.batches.put({ ...batch, qty_in_stock: batch.qty_in_stock - it.qty });
        await d.stock_movements.add(buildMovement({
          batch_id: batch.id, medicine_id: it.medicine_id, qty_delta: -it.qty,
          reason: 'sale', ref_type: 'sale_item', ref_id: itemRows[itemRows.length - 1]!.id,
        }));
      }

      const total = subtotal - discount;
      if (total < 0) throw new Error('মোট মূল্য negative হতে পারবে না');

      let cashPaid = 0, due = 0;
      if (input.payment_type === 'cash') {
        cashPaid = total; due = 0;
      } else if (input.payment_type === 'due') {
        if (!input.customer_id) throw new Error('বাকিতে বিক্রয়ে পাওনাদার নির্বাচন করুন');
        cashPaid = 0; due = total;
      } else {
        if (!input.customer_id) throw new Error('মিশ্র বিক্রয়ে পাওনাদার নির্বাচন করুন');
        cashPaid = Math.max(0, Math.min(total, Math.round(input.cash_paid_paisa || 0)));
        due = total - cashPaid;
      }

      await d.sales.add({
        id: saleId, client_txn_id, txn_no, sale_date: nowISO(),
        customer_id: input.customer_id ?? null,
        subtotal_paisa: subtotal, discount_paisa: discount, total_paisa: total,
        payment_type: input.payment_type, cash_paid_paisa: cashPaid, due_paisa: due,
        status: 'completed', note: input.note ?? null,
      });
      await d.sale_items.bulkAdd(itemRows);

      if (due > 0 && input.customer_id) {
        await d.customer_ledger.add({
          id: uuid(), customer_id: input.customer_id, entry_type: 'sale_due',
          amount_paisa: due, ref_sale_id: saleId, note: 'বাকিতে বিক্রয়', entry_date: nowISO(),
        });
        const c = await d.customers.get(input.customer_id);
        if (c && !c.first_due_date) await d.customers.put({ ...c, first_due_date: todayISO() });
        await recomputeCustomerDue(input.customer_id);
      }
      await audit('sale', saleId, 'create', { total_paisa: total, due_paisa: due });
      return { sale_id: saleId, txn_no, total_paisa: total, due_paisa: due };
    });
}

// ============================================================
// DUE PAYMENT (overpay রোধ — নিয়ম ৬)
// ============================================================
export async function recordDuePayment(input: {
  customer_id: string; amount_paisa: number;
  method: 'cash' | 'bkash' | 'nagad' | 'rocket' | 'other';
  pay_date: string; note?: string | null;
}) {
  const d = db();
  if (input.amount_paisa <= 0) throw new Error('পরিশোধের পরিমাণ ০-এর বেশি হতে হবে');
  return d.transaction('rw', [d.customers, d.customer_ledger, d.due_payments, d.audit_logs], async () => {
    const c = await d.customers.get(input.customer_id);
    if (!c) throw new Error('পাওনাদার পাওয়া যায়নি');
    if (input.amount_paisa > c.current_due_paisa) {
      throw new Error('পরিশোধ বর্তমান বাকি থেকে বেশি হতে পারবে না');
    }
    const payId = uuid();
    await d.due_payments.add({
      id: payId, client_txn_id: newClientTxnId('due'), receipt_ref: `R-${Date.now()}`,
      customer_id: input.customer_id, pay_date: input.pay_date, amount_paisa: input.amount_paisa,
      method: input.method, status: 'completed', note: input.note ?? null,
    });
    await d.customer_ledger.add({
      id: uuid(), customer_id: input.customer_id, entry_type: 'payment',
      amount_paisa: -input.amount_paisa, ref_payment_id: payId, note: 'বাকি আদায়', entry_date: nowISO(),
    });
    await recomputeCustomerDue(input.customer_id);
    await audit('due_payment', payId, 'create', { amount_paisa: input.amount_paisa });
    return { payment_id: payId };
  });
}

// ============================================================
// ADD STOCK
// ============================================================
export async function addStock(input: {
  medicine_id: string; batch_no?: string | null; expiry_date?: string | null;
  qty: number; purchase_price_paisa: number; sale_price_paisa: number;
  entry_date: string; invoice_no?: string | null; note?: string | null;
}) {
  const d = db();
  if (input.qty <= 0) throw new Error('পরিমাণ ০-এর বেশি হতে হবে');
  return d.transaction('rw', [d.stock_movements, d.batches, d.stock_entries, d.audit_logs], async () => {
    const existing = await d.batches
      .where('medicine_id').equals(input.medicine_id)
      .filter((b) => (b.batch_no ?? '') === (input.batch_no ?? ''))
      .first();
    let batchId: string;
    if (existing) {
      batchId = existing.id;
      await d.batches.put({
        ...existing,
        qty_in_stock: existing.qty_in_stock + input.qty,
        purchase_price_paisa: input.purchase_price_paisa,
        sale_price_paisa: input.sale_price_paisa,
        expiry_date: input.expiry_date ?? existing.expiry_date,
      });
    } else {
      batchId = uuid();
      await d.batches.add({
        id: batchId, medicine_id: input.medicine_id, batch_no: input.batch_no ?? null,
        expiry_date: input.expiry_date ?? null, purchase_price_paisa: input.purchase_price_paisa,
        sale_price_paisa: input.sale_price_paisa, qty_in_stock: input.qty,
      });
    }
    const entryId = uuid();
    await d.stock_entries.add({
      id: entryId, client_txn_id: newClientTxnId('stock'), batch_id: batchId, qty: input.qty,
      purchase_price_paisa: input.purchase_price_paisa, sale_price_paisa: input.sale_price_paisa,
      entry_date: input.entry_date, invoice_no: input.invoice_no ?? null, note: input.note ?? null,
      created_at: nowISO(), status: 'completed',
    });
    await d.stock_movements.add(buildMovement({
      batch_id: batchId, medicine_id: input.medicine_id, qty_delta: input.qty,
      reason: 'purchase', ref_type: 'stock_entry', ref_id: entryId,
      business_date: input.entry_date,
    }));
    await audit('stock_entry', entryId, 'create', { batch_id: batchId, qty: input.qty });
    return { entry_id: entryId, batch_id: batchId };
  });
}

// ============================================================
// EXPENSE
// ============================================================
export async function addExpense(input: {
  category_id: string; amount_paisa: number; expense_date: string;
  description?: string | null; payment_source: string;
}) {
  if (input.amount_paisa <= 0) throw new Error('পরিমাণ ০-এর বেশি হতে হবে');
  const id = uuid();
  await db().expenses.add({
    id, client_txn_id: newClientTxnId('exp'), expense_date: input.expense_date,
    category_id: input.category_id, amount_paisa: input.amount_paisa,
    description: input.description ?? null, receipt_url: null,
    payment_source: input.payment_source as Expense['payment_source'], status: 'completed',
  });
  await audit('expense', id, 'create', { amount_paisa: input.amount_paisa });
  return { expense_id: id };
}

// ============================================================
// STOCK ADJUSTMENT (কারণ বাধ্যতামূলক — নিয়ম ১২)
// ============================================================
export async function adjustStock(input: {
  batch_id: string; qty: number; reason: AdjustmentReason; note?: string | null;
}) {
  const d = db();
  if (input.qty === 0) throw new Error('পরিমাণ ০ হতে পারবে না');
  if (!input.reason) throw new Error('কারণ বাধ্যতামূলক');
  return d.transaction('rw', [d.stock_movements, d.batches, d.stock_adjustments, d.audit_logs], async () => {
    const b = await d.batches.get(input.batch_id);
    if (!b) throw new Error('batch পাওয়া যায়নি');
    if (b.qty_in_stock + input.qty < 0) throw new Error('স্টক negative হতে পারবে না');
    await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock + input.qty });
    const id = uuid();
    await d.stock_movements.add(buildMovement({
      batch_id: b.id, medicine_id: b.medicine_id, qty_delta: input.qty,
      reason: 'adjustment', ref_type: 'stock_adjustment', ref_id: id,
      note: input.reason,
    }));
    await d.stock_adjustments.add({
      id, client_txn_id: newClientTxnId('adj'), batch_id: input.batch_id, qty: input.qty,
      reason: input.reason, note: input.note ?? null, adjusted_at: nowISO(), status: 'completed',
    });
    await audit('stock_adjustment', id, 'create', { qty: input.qty, reason: input.reason });
    return { adjustment_id: id };
  });
}

// ============================================================
// SALE RETURN
// ============================================================
export interface SaleSummary {
  id: string; txn_no: string; sale_date: string; total_paisa: number;
  due_paisa: number; payment_type: string; customer_id: string | null; status: string;
}
export async function fetchRecentSales(limit = 30): Promise<SaleSummary[]> {
  const all = await db().sales.filter((s) => s.status === 'completed').toArray();
  all.sort((a, b) => b.sale_date.localeCompare(a.sale_date));
  return all.slice(0, limit).map((s) => ({
    id: s.id, txn_no: s.txn_no, sale_date: s.sale_date, total_paisa: s.total_paisa,
    due_paisa: s.due_paisa, payment_type: s.payment_type, customer_id: s.customer_id ?? null,
    status: s.status,
  }));
}

export interface SaleItemRow {
  id: string; medicine_id: string; batch_id: string; qty: number;
  unit_price_paisa: number; line_total_paisa: number; medicine_name?: string;
}
export async function fetchSaleItems(saleId: string): Promise<SaleItemRow[]> {
  const d = db();
  const items = await d.sale_items.where('sale_id').equals(saleId).toArray();
  const meds = await d.medicines.bulkGet(items.map((i) => i.medicine_id));
  return items.map((i, idx) => ({
    id: i.id, medicine_id: i.medicine_id, batch_id: i.batch_id, qty: i.qty,
    unit_price_paisa: i.unit_price_paisa, line_total_paisa: i.line_total_paisa,
    medicine_name: meds[idx]?.name,
  }));
}

export async function createSaleReturn(input: {
  sale_id: string; reason: string; refund_paisa: number;
  items: { sale_item_id: string; batch_id: string; qty: number; restock: boolean }[];
}) {
  const d = db();
  if (input.items.length === 0) throw new Error('অন্তত একটি ওষুধ নির্বাচন করুন');
  if (!input.reason?.trim()) throw new Error('রিটার্নের কারণ দিন');
  return d.transaction('rw',
    [d.stock_movements, d.sales, d.sale_items, d.sale_returns, d.sale_return_items, d.batches, d.customers, d.customer_ledger, d.audit_logs],
    async () => {
      const sale = await d.sales.get(input.sale_id);
      if (!sale) throw new Error('বিক্রয় পাওয়া যায়নি');
      if (sale.status === 'cancelled') throw new Error('বাতিল বিক্রয়ে রিটার্ন হয় না');

      const retId = uuid();
      await d.sale_returns.add({
        id: retId, client_txn_id: newClientTxnId('ret'), sale_id: input.sale_id,
        return_date: todayISO(), refund_paisa: Math.max(0, Math.round(input.refund_paisa || 0)),
        reason: input.reason, created_at: nowISO(), status: 'completed',
      });

      let returnedValue = 0;
      for (const it of input.items) {
        if (it.qty <= 0) continue;
        const si = await d.sale_items.get(it.sale_item_id);
        if (!si || si.sale_id !== input.sale_id) throw new Error('বিক্রয় আইটেম পাওয়া যায়নি');
        if (it.qty > si.qty) throw new Error('রিটার্ন পরিমাণ বিক্রীত পরিমাণের বেশি');
        returnedValue += Math.round(si.unit_price_paisa * it.qty);
        const returnItemId = uuid();
        await d.sale_return_items.add({
          id: returnItemId, return_id: retId, sale_item_id: si.id, batch_id: it.batch_id,
          qty: it.qty, restock: it.restock,
        });
        if (it.restock) {
          const b = await d.batches.get(it.batch_id);
          if (b) {
            await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock + it.qty });
            await d.stock_movements.add(buildMovement({
              batch_id: b.id, medicine_id: b.medicine_id, qty_delta: it.qty,
              reason: 'return', ref_type: 'sale_return_item', ref_id: returnItemId,
            }));
          }
        }
      }

      // বাকিতে বিক্রয় হলে customer balance কমবে (ফেরত মূল্য অনুযায়ী, বর্তমান বাকির মধ্যে)
      if (sale.customer_id && sale.due_paisa > 0) {
        const c = await d.customers.get(sale.customer_id);
        const reduce = Math.min(returnedValue, c?.current_due_paisa ?? 0);
        if (reduce > 0) {
          await d.customer_ledger.add({
            id: uuid(), customer_id: sale.customer_id, entry_type: 'return_adjust',
            amount_paisa: -reduce, ref_sale_id: input.sale_id, ref_return_id: retId,
            note: 'বিক্রয় রিটার্ন', entry_date: nowISO(),
          });
          await recomputeCustomerDue(sale.customer_id);
        }
      }
      await audit('sale_return', retId, 'create', { sale_id: input.sale_id, returned_value: returnedValue });
      return { return_id: retId };
    });
}

// ============================================================
// CASH SESSION
// ============================================================
export interface CashSummary {
  opening_paisa: number; cash_sales_paisa: number; collection_paisa: number;
  expense_paisa: number; purchase_paisa: number; expected_closing_paisa: number;
  actual_closing_paisa: number | null; difference_paisa: number | null;
}
export async function fetchCashSummary(date: string): Promise<CashSummary> {
  const d = db();
  const [session, sales, payments, expenses, entries] = await Promise.all([
    d.cash_sessions.where('session_date').equals(date).filter(isLive).first(),
    d.sales.filter((s) => s.status === 'completed' && dateOf(s.sale_date) === date).toArray(),
    d.due_payments.filter((p) => p.status === 'completed' && p.method === 'cash' && p.pay_date === date).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && e.payment_source === 'cash' && e.expense_date === date).toArray(),
    d.stock_entries.filter((e) => isActive(e) && e.entry_date === date).toArray(),
  ]);
  const opening = session?.opening_cash_paisa ?? 0;
  const cashSales = sum(sales.map((s) => s.cash_paid_paisa));
  const collection = sum(payments.map((p) => p.amount_paisa));
  const expense = sum(expenses.map((e) => e.amount_paisa));
  const purchase = sum(entries.map((e) => Math.round(e.qty * e.purchase_price_paisa)));
  const expected = opening + cashSales + collection - expense - purchase;
  const actual = session?.actual_closing_paisa ?? null;
  return {
    opening_paisa: opening, cash_sales_paisa: cashSales, collection_paisa: collection,
    expense_paisa: expense, purchase_paisa: purchase, expected_closing_paisa: expected,
    actual_closing_paisa: actual, difference_paisa: actual == null ? null : actual - expected,
  };
}
export async function saveCashSession(input: {
  date: string; opening_paisa: number; actual_paisa: number | null; note?: string | null;
}) {
  const d = db();
  const existing = await d.cash_sessions.where('session_date').equals(input.date).filter(isLive).first();
  const row = {
    id: existing?.id ?? uuid(), session_date: input.date,
    opening_cash_paisa: input.opening_paisa, actual_closing_paisa: input.actual_paisa,
    note: input.note ?? null,
  };
  await d.cash_sessions.put(row);
  await audit('cash_session', row.id, 'upsert', row);
}

// ============================================================
// REPORTS
// ============================================================

export interface ReturnTotals {
  /** ফেরত যাওয়া বিক্রয়মূল্য — বিক্রয় থেকে বাদ যাবে। */
  value_paisa: number;
  /** ফেরত এসে স্টকে ঢোকা মালের ক্রয়মূল্য — লাভের হিসাব থেকে বাদ যাবে। */
  restocked_cost_paisa: number;
  /** গ্রাহককে ফেরত দেওয়া টাকা। */
  refund_paisa: number;
}

/** নির্দিষ্ট সময়ের সক্রিয় (বাতিল নয়) রিটার্নের হিসাব। */
async function returnTotals(inRange: (d: string) => boolean): Promise<ReturnTotals> {
  const d = db();
  const rets = (await d.sale_returns.toArray()).filter((r) => isLive(r) && isActive(r) && inRange(r.return_date));
  if (rets.length === 0) return { value_paisa: 0, restocked_cost_paisa: 0, refund_paisa: 0 };
  const retIds = new Set(rets.map((r) => r.id));
  const items = (await d.sale_return_items.toArray()).filter((i) => retIds.has(i.return_id));
  const saleItems = await d.sale_items.bulkGet(items.map((i) => i.sale_item_id));
  let value = 0, cost = 0;
  items.forEach((it, idx) => {
    const si = saleItems[idx];
    if (!si) return;
    value += Math.round(si.unit_price_paisa * it.qty);
    if (it.restock) cost += Math.round(si.cost_price_paisa * it.qty);
  });
  return {
    value_paisa: value,
    restocked_cost_paisa: cost,
    refund_paisa: sum(rets.map((r) => r.refund_paisa)),
  };
}
export interface DailyReport {
  total_sales_paisa: number; cash_sales_paisa: number; due_sales_paisa: number;
  collection_paisa: number; expense_paisa: number; gross_profit_paisa: number;
  net_profit_paisa: number; stock_purchase_paisa: number;
  /** ফেরত দেওয়া টাকা — বিক্রয় ও লাভ থেকে বাদ দেওয়া হয়েছে। */
  return_refund_paisa: number;
}
export async function fetchDailyReport(date: string): Promise<DailyReport> {
  const d = db();
  const sales = await d.sales.filter((s) => s.status === 'completed' && dateOf(s.sale_date) === date).toArray();
  const saleIds = new Set(sales.map((s) => s.id));
  const [payments, expenses, entries, allItems] = await Promise.all([
    d.due_payments.filter((p) => p.status === 'completed' && p.pay_date === date).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && e.expense_date === date).toArray(),
    d.stock_entries.filter((e) => isActive(e) && e.entry_date === date).toArray(),
    d.sale_items.filter((i) => saleIds.has(i.sale_id)).toArray(),
  ]);
  const ret = await returnTotals((dt) => dt === date);
  // রিটার্নে বিক্রয় কমে, আর ফেরত আসা মাল স্টকে ফিরলে তার ক্রয়মূল্যও লাভের হিসাব থেকে বাদ যায়।
  const gross = sum(allItems.map((i) => i.line_total_paisa - Math.round(i.cost_price_paisa * i.qty)))
    - (ret.value_paisa - ret.restocked_cost_paisa);
  const expense = sum(expenses.map((e) => e.amount_paisa));
  return {
    total_sales_paisa: sum(sales.map((s) => s.total_paisa)) - ret.value_paisa,
    cash_sales_paisa: sum(sales.map((s) => s.cash_paid_paisa)),
    due_sales_paisa: sum(sales.map((s) => s.due_paisa)),
    collection_paisa: sum(payments.map((p) => p.amount_paisa)),
    expense_paisa: expense,
    gross_profit_paisa: gross,
    net_profit_paisa: gross - expense,
    stock_purchase_paisa: sum(entries.map((e) => Math.round(e.qty * e.purchase_price_paisa))),
    return_refund_paisa: ret.refund_paisa,
  };
}

export interface MonthlyReport {
  total_sales_paisa: number; purchase_cost_paisa: number; gross_profit_paisa: number;
  total_expense_paisa: number; net_profit_paisa: number; new_due_paisa: number;
  collected_due_paisa: number; current_total_due_paisa: number;
  return_refund_paisa: number;
  expense_by_category: Record<string, number>;
}
export async function fetchMonthlyReport(year: number, month: number): Promise<MonthlyReport> {
  const d = db();
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  // পরের মাসের ১ তারিখ, স্ট্রিং হিসেবেই তৈরি — timezone রূপান্তরে মাসের শেষ দিন যেন বাদ না পড়ে।
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const inRange = (dt: string) => dt >= start && dt < end;

  const sales = await d.sales.filter((s) => s.status === 'completed' && inRange(dateOf(s.sale_date))).toArray();
  const saleIds = new Set(sales.map((s) => s.id));
  const [items, entries, expenses, ledger, ret, payments, customers, cats] = await Promise.all([
    d.sale_items.filter((i) => saleIds.has(i.sale_id)).toArray(),
    d.stock_entries.filter((e) => isActive(e) && inRange(e.entry_date)).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && inRange(e.expense_date)).toArray(),
    d.customer_ledger.filter((l) => l.entry_type === 'sale_due' && inRange(dateOf(l.entry_date))).toArray(),
    returnTotals(inRange),
    d.due_payments.filter((p) => p.status === 'completed' && inRange(p.pay_date)).toArray(),
    liveArray(d.customers),
    liveArray(d.expense_categories),
  ]);
  const catMap = new Map(cats.map((c) => [c.id, c.bn_name]));
  const byCat: Record<string, number> = {};
  for (const e of expenses) {
    const k = catMap.get(e.category_id) ?? 'অন্যান্য';
    byCat[k] = (byCat[k] ?? 0) + e.amount_paisa;
  }
  const gross = sum(items.map((i) => i.line_total_paisa - Math.round(i.cost_price_paisa * i.qty)))
    - (ret.value_paisa - ret.restocked_cost_paisa);
  const expense = sum(expenses.map((e) => e.amount_paisa));
  return {
    total_sales_paisa: sum(sales.map((s) => s.total_paisa)) - ret.value_paisa,
    purchase_cost_paisa: sum(entries.map((e) => Math.round(e.qty * e.purchase_price_paisa))),
    gross_profit_paisa: gross,
    total_expense_paisa: expense,
    net_profit_paisa: gross - expense,
    // বাতিল বিক্রয়ের বাকি বাদ — শুধু সক্রিয় বিক্রয়ের বাকি গোনা হয়।
    new_due_paisa: sum(ledger.filter((l) => l.ref_sale_id && saleIds.has(l.ref_sale_id)).map((l) => l.amount_paisa)),
    collected_due_paisa: sum(payments.map((p) => p.amount_paisa)),
    current_total_due_paisa: sum(customers.map((c) => c.current_due_paisa)),
    return_refund_paisa: ret.refund_paisa,
    expense_by_category: byCat,
  };
}

export interface InventoryReport {
  rows: StockRow[]; outCount: number; lowCount: number;
  expiringCount: number; expiredCount: number; stockValuePaisa: number;
}
export async function fetchInventoryReport(): Promise<InventoryReport> {
  const rows = await fetchStockRows();
  return {
    rows,
    outCount: rows.filter((r) => r.stock_status === 'out').length,
    lowCount: rows.filter((r) => r.stock_status === 'low').length,
    expiringCount: rows.filter((r) => ['d30', 'd60', 'd90'].includes(r.expiry_status ?? '')).length,
    expiredCount: rows.filter((r) => r.expiry_status === 'expired').length,
    stockValuePaisa: rows.reduce((a, r) => a + Math.round(r.qty_in_stock * r.purchase_price_paisa), 0),
  };
}


// ============================================================
// পাওনাদার — ledger, সংশোধন, পূর্বের বকেয়া, মুছে ফেলা
// ============================================================

export interface LedgerRow extends CustomerLedger {
  label: string;
}

const LEDGER_LABEL: Record<string, string> = {
  opening: 'পূর্বের বকেয়া',
  sale_due: 'বাকিতে বিক্রয়',
  payment: 'বাকি আদায়',
  return_adjust: 'রিটার্ন সমন্বয়',
};

/** এক পাওনাদারের সম্পূর্ণ খতিয়ান, নতুন এন্ট্রি আগে। */
export async function fetchCustomerLedger(customerId: string): Promise<LedgerRow[]> {
  const rows = (await db().customer_ledger.where('customer_id').equals(customerId).toArray()).filter(isLive);
  rows.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  return rows.map((r) => ({ ...r, label: LEDGER_LABEL[r.entry_type] ?? r.entry_type }));
}

/** পাওনাদারের তথ্য সংশোধন (বাকির অঙ্ক এখানে বদলায় না)। */
export async function updateCustomer(id: string, patch: {
  name?: string; phone?: string | null; village?: string | null; note?: string | null;
}): Promise<Customer> {
  const d = db();
  const cur = await d.customers.get(id);
  if (!cur) throw new Error('পাওনাদার পাওয়া যায়নি');
  const name = (patch.name ?? cur.name).trim();
  if (!name) throw new Error('নাম দিন');
  const next: Customer = { ...cur, ...patch, name };
  await d.customers.put(next);
  await audit('customer', id, 'update', next, cur);
  return next;
}

/**
 * অ্যাপ ব্যবহারের আগের পুরোনো বকেয়া বসানো বা সংশোধন।
 * প্রতি পাওনাদারে একটিই "পূর্বের বকেয়া" এন্ট্রি থাকে; ০ দিলে সেটি সরে যায়।
 */
export async function setCustomerOpeningDue(customerId: string, amountPaisa: number): Promise<void> {
  const d = db();
  const amount = Math.round(amountPaisa || 0);
  if (amount < 0) throw new Error('পূর্বের বকেয়া negative হতে পারবে না');
  await d.transaction('rw', [d.customers, d.customer_ledger, d.audit_logs], async () => {
    const c = await d.customers.get(customerId);
    if (!c) throw new Error('পাওনাদার পাওয়া যায়নি');
    const existing = await d.customer_ledger
      .where('customer_id').equals(customerId)
      .filter((l) => l.entry_type === 'opening')
      .first();
    const before = existing?.amount_paisa ?? 0;
    if (existing) {
      if (amount === 0) await markDeleted(d.customer_ledger, existing.id);
      else await d.customer_ledger.put({ ...existing, amount_paisa: amount });
    } else if (amount > 0) {
      await d.customer_ledger.add({
        id: uuid(), customer_id: customerId, entry_type: 'opening',
        amount_paisa: amount, note: 'অ্যাপ শুরুর আগের বকেয়া', entry_date: nowISO(),
      });
    }
    if (amount > 0 && !c.first_due_date) {
      await d.customers.put({ ...c, first_due_date: todayISO() });
    }
    await recomputeCustomerDue(customerId);
    await audit('customer', customerId, 'opening_due', { amount_paisa: amount }, { amount_paisa: before });
  });
}

/** কোনো লেনদেন না থাকলে পাওনাদার সম্পূর্ণ মুছে ফেলা যায়। */
export async function deleteCustomer(id: string): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.customers, d.customer_ledger, d.sales, d.due_payments, d.audit_logs], async () => {
    const c = await d.customers.get(id);
    if (!c) throw new Error('পাওনাদার পাওয়া যায়নি');
    const saleCount = await d.sales.filter((x) => x.customer_id === id).count();
    if (saleCount > 0) throw new Error('এই পাওনাদারের বিক্রয় আছে, মুছে ফেলা যাবে না');
    const payCount = await d.due_payments.where('customer_id').equals(id).count();
    if (payCount > 0) throw new Error('এই পাওনাদারের আদায়ের রেকর্ড আছে, মুছে ফেলা যাবে না');
    const ledger = (await d.customer_ledger.where('customer_id').equals(id).toArray()).filter(isLive);
    const other = ledger.filter((l) => l.entry_type !== 'opening');
    if (other.length > 0) throw new Error('এই পাওনাদারের খতিয়ান আছে, মুছে ফেলা যাবে না');
    for (const l of ledger) await markDeleted(d.customer_ledger, l.id);
    await markDeleted(d.customers, id);
    await audit('customer', id, 'delete', null, c);
  });
}

// ============================================================
// বিক্রয় বাতিল — স্টক, বাকি ও ক্যাশ সবই ফিরে যায়
// ============================================================

export interface SaleHistoryRow {
  id: string; txn_no: string; sale_date: string; total_paisa: number;
  cash_paid_paisa: number; due_paisa: number; discount_paisa: number;
  payment_type: string; status: string; cancelled_reason?: string | null;
  customer_id: string | null; customer_name: string | null;
}

/** বিক্রয়ের তালিকা; বাতিল করা বিক্রয়ও দেখানো যায়। */
export async function fetchSalesHistory(
  limit = 50, includeCancelled = true,
): Promise<SaleHistoryRow[]> {
  const d = db();
  const [sales, customers] = await Promise.all([liveArray(d.sales), liveArray(d.customers)]);
  const nameOf = new Map(customers.map((c) => [c.id, c.name]));
  const rows = sales.filter((s) => includeCancelled || s.status === 'completed');
  rows.sort((a, b) => b.sale_date.localeCompare(a.sale_date));
  return rows.slice(0, limit).map((s) => ({
    id: s.id, txn_no: s.txn_no, sale_date: s.sale_date, total_paisa: s.total_paisa,
    cash_paid_paisa: s.cash_paid_paisa, due_paisa: s.due_paisa, discount_paisa: s.discount_paisa,
    payment_type: s.payment_type, status: s.status, cancelled_reason: s.cancelled_reason,
    customer_id: s.customer_id ?? null, customer_name: s.customer_id ? (nameOf.get(s.customer_id) ?? null) : null,
  }));
}

/**
 * বিক্রয় বাতিল। স্টক ফেরত যায়, বাকির খতিয়ান উল্টে যায়, রেকর্ড "বাতিল" হিসেবে থাকে।
 * রিটার্ন থাকা বিক্রয় আগে রিটার্ন বাতিল না করলে বাতিল হয় না।
 */
export async function cancelSale(saleId: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  await d.transaction('rw',
    [d.stock_movements, d.sales, d.sale_items, d.batches, d.customers, d.customer_ledger, d.sale_returns, d.audit_logs],
    async () => {
      const sale = await d.sales.get(saleId);
      if (!sale) throw new Error('বিক্রয় পাওয়া যায়নি');
      if (sale.status === 'cancelled') throw new Error('এই বিক্রয় আগেই বাতিল হয়েছে');
      const returns = await d.sale_returns.where('sale_id').equals(saleId).toArray();
      if (returns.some(isActive)) {
        throw new Error('এই বিক্রয়ে রিটার্ন আছে — আগে রিটার্ন বাতিল করুন');
      }
      const items = await d.sale_items.where('sale_id').equals(saleId).toArray();
      for (const it of items) {
        const b = await d.batches.get(it.batch_id);
        if (b) {
          await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock + it.qty });
          await d.stock_movements.add(buildMovement({
            batch_id: b.id, medicine_id: it.medicine_id, qty_delta: it.qty,
            reason: 'reversal', ref_type: 'sale_item', ref_id: it.id,
            note: 'বিক্রয় বাতিল',
          }));
        }
      }
      if (sale.customer_id) {
        const ledger = await d.customer_ledger
          .where('customer_id').equals(sale.customer_id)
          .filter((l) => l.ref_sale_id === saleId)
          .toArray();
        const reverse = sum(ledger.map((l) => l.amount_paisa));
        if (reverse !== 0) {
          await d.customer_ledger.add({
            id: uuid(), customer_id: sale.customer_id, entry_type: 'return_adjust',
            amount_paisa: -reverse, ref_sale_id: saleId,
            note: 'বিক্রয় বাতিল', entry_date: nowISO(),
          });
        }
        await recomputeCustomerDue(sale.customer_id);
      }
      await d.sales.put({ ...sale, status: 'cancelled', cancelled_reason: reason.trim() });
      await audit('sale', saleId, 'cancel', { reason: reason.trim() }, sale);
    });
}

// ============================================================
// বাকি আদায় বাতিল
// ============================================================

export interface DuePaymentRow extends DuePayment {
  customer_name: string | null;
}

export async function fetchRecentDuePayments(limit = 50): Promise<DuePaymentRow[]> {
  const d = db();
  const [pays, customers] = await Promise.all([liveArray(d.due_payments), liveArray(d.customers)]);
  const nameOf = new Map(customers.map((c) => [c.id, c.name]));
  pays.sort((a, b) => b.pay_date.localeCompare(a.pay_date));
  return pays.slice(0, limit).map((p) => ({ ...p, customer_name: nameOf.get(p.customer_id) ?? null }));
}

/** আদায় বাতিল — টাকা আবার বাকিতে যোগ হয়। */
export async function cancelDuePayment(paymentId: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  await d.transaction('rw', [d.due_payments, d.customer_ledger, d.customers, d.audit_logs], async () => {
    const pay = await d.due_payments.get(paymentId);
    if (!pay) throw new Error('আদায়ের রেকর্ড পাওয়া যায়নি');
    if (pay.status === 'cancelled') throw new Error('এই আদায় আগেই বাতিল হয়েছে');
    const ledger = await d.customer_ledger
      .where('customer_id').equals(pay.customer_id)
      .filter((l) => l.ref_payment_id === paymentId)
      .toArray();
    const reverse = sum(ledger.map((l) => l.amount_paisa));
    if (reverse !== 0) {
      await d.customer_ledger.add({
        id: uuid(), customer_id: pay.customer_id, entry_type: 'return_adjust',
        amount_paisa: -reverse, ref_payment_id: paymentId,
        note: 'আদায় বাতিল', entry_date: nowISO(),
      });
    }
    await recomputeCustomerDue(pay.customer_id);
    // আসল নোট মুছে যায় না — বাতিলের কারণ শেষে যোগ হয়।
    const note = [pay.note, `বাতিল: ${reason.trim()}`].filter(Boolean).join(' — ');
    await d.due_payments.put({ ...pay, status: 'cancelled', note });
    await audit('due_payment', paymentId, 'cancel', { reason: reason.trim() }, pay);
  });
}

// ============================================================
// খরচ — সংশোধন ও বাতিল
// ============================================================

export async function fetchExpenses(limit = 50): Promise<Expense[]> {
  const all = await liveArray(db().expenses);
  all.sort((a, b) => b.expense_date.localeCompare(a.expense_date));
  return all.slice(0, limit);
}

export async function updateExpense(id: string, patch: {
  category_id?: string; amount_paisa?: number; expense_date?: string;
  description?: string | null; payment_source?: ExpenseSource;
}): Promise<Expense> {
  const d = db();
  const cur = await d.expenses.get(id);
  if (!cur) throw new Error('খরচ পাওয়া যায়নি');
  if (cur.status === 'cancelled') throw new Error('বাতিল খরচ সংশোধন করা যায় না');
  const amount = patch.amount_paisa ?? cur.amount_paisa;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('পরিমাণ ০-এর বেশি হতে হবে');
  const next: Expense = { ...cur, ...patch, amount_paisa: Math.round(amount) };
  await d.expenses.put(next);
  await audit('expense', id, 'update', next, cur);
  return next;
}

export async function cancelExpense(id: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  const cur = await d.expenses.get(id);
  if (!cur) throw new Error('খরচ পাওয়া যায়নি');
  if (cur.status === 'cancelled') throw new Error('এই খরচ আগেই বাতিল হয়েছে');
  await d.expenses.put({
    ...cur, status: 'cancelled',
    description: `${cur.description ?? ''}${cur.description ? ' — ' : ''}বাতিল: ${reason.trim()}`,
  });
  await audit('expense', id, 'cancel', { reason: reason.trim() }, cur);
}

// ---- খরচের ক্যাটাগরি ----
export async function addExpenseCategory(input: { bn_name: string; is_recurring?: boolean }): Promise<ExpenseCategory> {
  const d = db();
  const bn = input.bn_name.trim();
  if (!bn) throw new Error('ক্যাটাগরির নাম দিন');
  const all = await liveArray(d.expense_categories);
  if (all.some((c) => c.bn_name.trim() === bn)) throw new Error('এই নামে ক্যাটাগরি আছে');
  const maxSort = all.reduce((a, c) => Math.max(a, c.sort_order), 0);
  const cat: ExpenseCategory = {
    id: uuid(),
    name: bn.replace(/\s+/g, '_').toLowerCase(),
    bn_name: bn,
    is_recurring: input.is_recurring ?? false,
    sort_order: Math.min(98, maxSort + 1),
  };
  await d.expense_categories.add(cat);
  await audit('expense_category', cat.id, 'create', cat);
  return cat;
}

export async function updateExpenseCategory(id: string, patch: { bn_name?: string; is_recurring?: boolean }): Promise<void> {
  const d = db();
  const cur = await d.expense_categories.get(id);
  if (!cur) throw new Error('ক্যাটাগরি পাওয়া যায়নি');
  const bn = (patch.bn_name ?? cur.bn_name).trim();
  if (!bn) throw new Error('ক্যাটাগরির নাম দিন');
  const all = await liveArray(d.expense_categories);
  if (all.some((c) => c.id !== id && c.bn_name.trim() === bn)) throw new Error('এই নামে ক্যাটাগরি আছে');
  await d.expense_categories.put({ ...cur, ...patch, bn_name: bn });
  await audit('expense_category', id, 'update', { ...cur, ...patch, bn_name: bn }, cur);
}

/** কোনো খরচ এই ক্যাটাগরিতে না থাকলেই মুছে ফেলা যায়। */
export async function deleteExpenseCategory(id: string): Promise<void> {
  const d = db();
  const cur = await d.expense_categories.get(id);
  if (!cur) throw new Error('ক্যাটাগরি পাওয়া যায়নি');
  const used = await d.expenses.where('category_id').equals(id).count();
  if (used > 0) throw new Error('এই ক্যাটাগরিতে খরচ আছে, মুছে ফেলা যাবে না');
  await markDeleted(d.expense_categories, id);
  await audit('expense_category', id, 'delete', null, cur);
}

// ============================================================
// স্টক এন্ট্রি — সংশোধন ও বাতিল
// ============================================================

export interface StockEntryRow extends StockEntry {
  medicine_name: string;
  batch_no: string | null;
  medicine_id: string;
  available_qty: number;
}

export async function fetchRecentStockEntries(limit = 50): Promise<StockEntryRow[]> {
  const d = db();
  const [entries, batches, meds] = await Promise.all([
    d.stock_entries.toArray(), d.batches.toArray(), d.medicines.toArray(),
  ]);
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const medMap = new Map(meds.map((m) => [m.id, m]));
  entries.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return entries.slice(0, limit).map((e) => {
    const b = batchMap.get(e.batch_id);
    const m = b ? medMap.get(b.medicine_id) : undefined;
    return {
      ...e,
      medicine_name: m?.name ?? 'অজানা ওষুধ',
      medicine_id: b?.medicine_id ?? '',
      batch_no: b?.batch_no ?? null,
      available_qty: b?.qty_in_stock ?? 0,
    };
  });
}

/** ভুল স্টক এন্ট্রি সংশোধন। পরিমাণ বদলালে batch-এর স্টকও সেই অনুযায়ী বদলায়। */
export async function updateStockEntry(id: string, patch: {
  qty?: number; purchase_price_paisa?: number; sale_price_paisa?: number;
  entry_date?: string; invoice_no?: string | null; note?: string | null;
}): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.stock_movements, d.stock_entries, d.batches, d.audit_logs], async () => {
    const cur = await d.stock_entries.get(id);
    if (!cur) throw new Error('স্টক এন্ট্রি পাওয়া যায়নি');
    if (!isActive(cur)) throw new Error('বাতিল এন্ট্রি সংশোধন করা যায় না');
    const qty = patch.qty ?? cur.qty;
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('পরিমাণ ০-এর বেশি হতে হবে');
    const purchase = patch.purchase_price_paisa ?? cur.purchase_price_paisa;
    const sale = patch.sale_price_paisa ?? cur.sale_price_paisa;
    if (purchase < 0 || sale < 0) throw new Error('দাম ০ বা তার বেশি হতে হবে');
    const batch = await d.batches.get(cur.batch_id);
    if (!batch) throw new Error('batch পাওয়া যায়নি');
    const delta = qty - cur.qty;
    if (batch.qty_in_stock + delta < 0) {
      throw new Error(`স্টকে আছে ${toBanglaDigits(batch.qty_in_stock)} — এত কমানো যাবে না, কিছু আগেই বিক্রি হয়েছে`);
    }
    // batch-এর চলতি দাম ঠিক করে সবচেয়ে নতুন সক্রিয় এন্ট্রি। পুরোনো এন্ট্রি সংশোধন করলে
    // চলতি দাম বদলানো উচিত নয়, নইলে নতুন দাম হারিয়ে যায়।
    const siblings = (await d.stock_entries.where('batch_id').equals(cur.batch_id).toArray())
      .filter((e) => isActive(e));
    const newest = siblings.reduce<StockEntry | null>(
      (a, b) => (!a || b.created_at > a.created_at ? b : a), null);
    const setsBatchPrice = !newest || newest.id === cur.id;
    await d.batches.put({
      ...batch,
      qty_in_stock: batch.qty_in_stock + delta,
      purchase_price_paisa: setsBatchPrice ? Math.round(purchase) : batch.purchase_price_paisa,
      sale_price_paisa: setsBatchPrice ? Math.round(sale) : batch.sale_price_paisa,
    });
    if (delta !== 0) {
      await d.stock_movements.add(buildMovement({
        batch_id: batch.id, medicine_id: batch.medicine_id, qty_delta: delta,
        reason: 'adjustment', ref_type: 'stock_entry', ref_id: id,
        note: 'স্টক এন্ট্রি সংশোধন',
      }));
    }
    const next: StockEntry = {
      ...cur, ...patch,
      qty, purchase_price_paisa: Math.round(purchase), sale_price_paisa: Math.round(sale),
    };
    await d.stock_entries.put(next);
    await audit('stock_entry', id, 'update', next, cur);
  });
}

/** স্টক এন্ট্রি বাতিল — যোগ করা পরিমাণ স্টক থেকে ফিরে যায়। */
export async function cancelStockEntry(id: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  await d.transaction('rw', [d.stock_movements, d.stock_entries, d.batches, d.audit_logs], async () => {
    const cur = await d.stock_entries.get(id);
    if (!cur) throw new Error('স্টক এন্ট্রি পাওয়া যায়নি');
    if (!isActive(cur)) throw new Error('এই এন্ট্রি আগেই বাতিল হয়েছে');
    const batch = await d.batches.get(cur.batch_id);
    if (!batch) throw new Error('batch পাওয়া যায়নি');
    if (batch.qty_in_stock < cur.qty) {
      throw new Error(`স্টকে আছে ${toBanglaDigits(batch.qty_in_stock)}, এন্ট্রি ছিল ${toBanglaDigits(cur.qty)} — কিছু আগেই বিক্রি হয়েছে, বাতিল করা যাবে না`);
    }
    await d.batches.put({ ...batch, qty_in_stock: batch.qty_in_stock - cur.qty });
    await d.stock_movements.add(buildMovement({
      batch_id: batch.id, medicine_id: batch.medicine_id, qty_delta: -cur.qty,
      reason: 'reversal', ref_type: 'stock_entry', ref_id: id,
      note: 'স্টক এন্ট্রি বাতিল',
    }));
    await d.stock_entries.put({ ...cur, status: 'cancelled', cancelled_reason: reason.trim() });
    await audit('stock_entry', id, 'cancel', { reason: reason.trim() }, cur);
  });
}

// ============================================================
// স্টক সমন্বয় বাতিল
// ============================================================

export interface StockAdjustmentRow extends StockAdjustment {
  medicine_name: string;
  batch_no: string | null;
}

export async function fetchRecentAdjustments(limit = 50): Promise<StockAdjustmentRow[]> {
  const d = db();
  const [adj, batches, meds] = await Promise.all([
    d.stock_adjustments.toArray(), d.batches.toArray(), d.medicines.toArray(),
  ]);
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const medMap = new Map(meds.map((m) => [m.id, m]));
  adj.sort((a, b) => b.adjusted_at.localeCompare(a.adjusted_at));
  return adj.slice(0, limit).map((a) => {
    const b = batchMap.get(a.batch_id);
    const m = b ? medMap.get(b.medicine_id) : undefined;
    return { ...a, medicine_name: m?.name ?? 'অজানা ওষুধ', batch_no: b?.batch_no ?? null };
  });
}

/** সমন্বয় বাতিল — স্টক আগের অবস্থায় ফিরে যায়। */
export async function cancelStockAdjustment(id: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  await d.transaction('rw', [d.stock_movements, d.stock_adjustments, d.batches, d.audit_logs], async () => {
    const cur = await d.stock_adjustments.get(id);
    if (!cur) throw new Error('সমন্বয় পাওয়া যায়নি');
    if (!isActive(cur)) throw new Error('এই সমন্বয় আগেই বাতিল হয়েছে');
    const batch = await d.batches.get(cur.batch_id);
    if (!batch) throw new Error('batch পাওয়া যায়নি');
    if (batch.qty_in_stock - cur.qty < 0) throw new Error('স্টক negative হয়ে যাবে, বাতিল করা যাবে না');
    await d.batches.put({ ...batch, qty_in_stock: batch.qty_in_stock - cur.qty });
    await d.stock_movements.add(buildMovement({
      batch_id: batch.id, medicine_id: batch.medicine_id, qty_delta: -cur.qty,
      reason: 'reversal', ref_type: 'stock_adjustment', ref_id: id,
      note: 'সমন্বয় বাতিল',
    }));
    await d.stock_adjustments.put({ ...cur, status: 'cancelled', cancelled_reason: reason.trim() });
    await audit('stock_adjustment', id, 'cancel', { reason: reason.trim() }, cur);
  });
}

// ============================================================
// বিক্রয় রিটার্ন বাতিল
// ============================================================

export interface SaleReturnRow extends SaleReturn {
  txn_no: string;
  item_count: number;
}

export async function fetchRecentReturns(limit = 50): Promise<SaleReturnRow[]> {
  const d = db();
  const [rets, sales, items] = await Promise.all([
    d.sale_returns.toArray(), d.sales.toArray(), d.sale_return_items.toArray(),
  ]);
  const txnOf = new Map(sales.map((s) => [s.id, s.txn_no]));
  rets.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rets.slice(0, limit).map((r) => ({
    ...r,
    txn_no: txnOf.get(r.sale_id) ?? '—',
    item_count: items.filter((i) => i.return_id === r.id).length,
  }));
}

/** রিটার্ন বাতিল — ফেরত আসা স্টক আবার কমে, বাকির সমন্বয় উল্টে যায়। */
export async function cancelSaleReturn(id: string, reason: string): Promise<void> {
  const d = db();
  if (!reason.trim()) throw new Error('বাতিলের কারণ লিখুন');
  await d.transaction('rw',
    [d.stock_movements, d.sale_returns, d.sale_return_items, d.sales, d.batches, d.customers, d.customer_ledger, d.audit_logs],
    async () => {
      const cur = await d.sale_returns.get(id);
      if (!cur) throw new Error('রিটার্ন পাওয়া যায়নি');
      if (!isActive(cur)) throw new Error('এই রিটার্ন আগেই বাতিল হয়েছে');
      const items = await d.sale_return_items.where('return_id').equals(id).toArray();
      for (const it of items) {
        if (!it.restock) continue;
        const b = await d.batches.get(it.batch_id);
        if (!b) continue;
        if (b.qty_in_stock < it.qty) {
          throw new Error('ফেরত আসা স্টক আবার বিক্রি হয়ে গেছে, রিটার্ন বাতিল করা যাবে না');
        }
        await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock - it.qty });
        await d.stock_movements.add(buildMovement({
          batch_id: b.id, medicine_id: b.medicine_id, qty_delta: -it.qty,
          reason: 'reversal', ref_type: 'sale_return_item', ref_id: it.id,
          note: 'রিটার্ন বাতিল',
        }));
      }
      const sale = await d.sales.get(cur.sale_id);
      if (sale?.customer_id) {
        // শুধু এই রিটার্নের এন্ট্রিগুলো — একই বিক্রয়ে একাধিক রিটার্ন থাকলেও অন্যগুলো অক্ষত থাকে।
        let ledger = await d.customer_ledger
          .where('customer_id').equals(sale.customer_id)
          .filter((l) => l.ref_return_id === id)
          .toArray();
        if (ledger.length === 0) {
          // পুরোনো রেকর্ডে ref_return_id নেই। তখন কেবল একটিমাত্র রিটার্ন থাকলে নিরাপদে চেনা যায়।
          const allReturns = await d.sale_returns.where('sale_id').equals(cur.sale_id).toArray();
          if (allReturns.length > 1) {
            throw new Error('এই পুরোনো রিটার্নটি নিরাপদে বাতিল করা যাচ্ছে না — একই বিক্রয়ে একাধিক রিটার্ন আছে। বাকির অঙ্ক পাওনাদার পেজ থেকে ঠিক করুন।');
          }
          ledger = await d.customer_ledger
            .where('customer_id').equals(sale.customer_id)
            .filter((l) => l.ref_sale_id === cur.sale_id
              && l.entry_type === 'return_adjust'
              && l.note === 'বিক্রয় রিটার্ন')
            .toArray();
        }
        const reverse = sum(ledger.map((l) => l.amount_paisa));
        if (reverse !== 0) {
          await d.customer_ledger.add({
            id: uuid(), customer_id: sale.customer_id, entry_type: 'return_adjust',
            amount_paisa: -reverse, ref_sale_id: cur.sale_id, ref_return_id: id,
            note: 'রিটার্ন বাতিল', entry_date: nowISO(),
          });
          await recomputeCustomerDue(sale.customer_id);
        }
      }
      await d.sale_returns.put({ ...cur, status: 'cancelled', cancelled_reason: reason.trim() });
      await audit('sale_return', id, 'cancel', { reason: reason.trim() }, cur);
    });
}

// ============================================================
// ওষুধ ও batch মুছে ফেলা (কোনো লেনদেন না থাকলেই)
// ============================================================

/** batch-এ কোনো স্টক এন্ট্রি, বিক্রয়, সমন্বয় বা রিটার্ন না থাকলে মুছে ফেলা যায়। */
export async function deleteBatch(batchId: string): Promise<void> {
  const d = db();
  await d.transaction('rw',
    [d.batches, d.stock_entries, d.sale_items, d.stock_adjustments, d.sale_return_items, d.audit_logs],
    async () => {
      const cur = await d.batches.get(batchId);
      if (!cur) throw new Error('batch পাওয়া যায়নি');
      const entries = await d.stock_entries.where('batch_id').equals(batchId).count();
      if (entries > 0) throw new Error('এই batch-এ স্টক এন্ট্রি আছে, মুছে ফেলা যাবে না');
      const sold = await d.sale_items.where('batch_id').equals(batchId).count();
      if (sold > 0) throw new Error('এই batch থেকে বিক্রয় হয়েছে, মুছে ফেলা যাবে না');
      const adj = await d.stock_adjustments.where('batch_id').equals(batchId).count();
      if (adj > 0) throw new Error('এই batch-এ সমন্বয় আছে, মুছে ফেলা যাবে না');
      const ret = await d.sale_return_items.where('batch_id').equals(batchId).count();
      if (ret > 0) throw new Error('এই batch-এ রিটার্ন আছে, মুছে ফেলা যাবে না');
      await markDeleted(d.batches, batchId);
      await audit('batch', batchId, 'delete', null, cur);
    });
}

/** ওষুধের কোনো batch বা বিক্রয় না থাকলে সম্পূর্ণ মুছে ফেলা যায়। */
export async function deleteMedicine(id: string): Promise<void> {
  const d = db();
  await d.transaction('rw', [d.medicines, d.batches, d.sale_items, d.audit_logs], async () => {
    const cur = await d.medicines.get(id);
    if (!cur) throw new Error('ওষুধ পাওয়া যায়নি');
    const sold = await d.sale_items.where('medicine_id').equals(id).count();
    if (sold > 0) throw new Error('এই ওষুধের বিক্রয় আছে, মুছে ফেলা যাবে না — বন্ধ করুন');
    const batches = await d.batches.where('medicine_id').equals(id).count();
    if (batches > 0) throw new Error('এই ওষুধের batch আছে, আগে batch মুছুন অথবা ওষুধ বন্ধ করুন');
    await markDeleted(d.medicines, id);
    await audit('medicine', id, 'delete', null, cur);
  });
}

// ============================================================
// ক্যাশ সেশন মুছে ফেলা
// ============================================================
export async function deleteCashSession(date: string): Promise<void> {
  const d = db();
  const cur = await d.cash_sessions.where('session_date').equals(date).first();
  if (!cur) throw new Error('এই দিনের ক্যাশ হিসাব নেই');
  await markDeleted(d.cash_sessions, cur.id);
  await audit('cash_session', cur.id, 'delete', null, cur);
}

// business-rules re-export used only for typing convenience
export { thresholdFor };
