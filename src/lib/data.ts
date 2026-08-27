'use client';

// অ্যাপের ডেটা স্তর — সম্পূর্ণ local (IndexedDB via Dexie)।
// সব ব্যবসায়িক নিয়ম ও আর্থিক হিসাব এখানে transaction-এ enforce হয় (Section ১৮)।
import {
  db, uuid, nowISO, todayISO, newClientTxnId, newTxnNo, audit, ensureSeeded, getSettings,
} from '@/lib/db/local';
import { isExpired, thresholdFor } from '@/lib/business-rules';
import type {
  StockRow, Customer, SaleItemInput, AdjustmentReason, Medicine, MedicineBatch,
  MedicineType, UnitType, AppSettings, ExpenseCategory, Expense,
} from '@/types/db';

function dateOf(iso: string): string {
  return iso.slice(0, 10);
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + (b || 0), 0);
}

// ============================================================
// STOCK ROWS (medicines + batches + threshold/status)
// ============================================================
export async function fetchStockRows(): Promise<StockRow[]> {
  await ensureSeeded();
  const d = db();
  const [meds, batches, settings] = await Promise.all([
    d.medicines.toArray(),
    d.batches.toArray(),
    getSettings(),
  ]);
  const medMap = new Map(meds.map((m) => [m.id, m]));
  const today = new Date();
  const rows: StockRow[] = [];
  for (const b of batches) {
    const m = medMap.get(b.medicine_id);
    if (!m || !m.is_active) continue;
    const th = m.low_stock_threshold ?? typeThreshold(m.type, settings);
    const status: StockRow['stock_status'] =
      b.qty_in_stock <= 0 ? 'out' : b.qty_in_stock <= th ? 'low' : 'normal';
    rows.push({
      batch_id: b.id, medicine_id: m.id, name: m.name, bn_name: m.bn_name,
      generic_name: m.generic_name, company: m.company, type: m.type, unit: m.unit,
      batch_no: b.batch_no, expiry_date: b.expiry_date, qty_in_stock: b.qty_in_stock,
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
  const meds = await db().medicines.filter((m) => m.is_active).toArray();
  meds.sort((a, b) => a.name.localeCompare(b.name));
  return meds;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const cs = await db().customers.toArray();
  cs.sort((a, b) => a.name.localeCompare(b.name));
  return cs;
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  await ensureSeeded();
  const cats = await db().expense_categories.toArray();
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
    d.customers.toArray(),
    fetchStockRows(),
  ]);
  const todaySales = sum(sales.map((s) => s.total_paisa));
  const todayExpense = sum(expenses.map((e) => e.amount_paisa));
  return {
    todaySalesPaisa: todaySales,
    todayCashPaisa: sum(sales.map((s) => s.cash_paid_paisa)),
    todayDuePaisa: sum(sales.map((s) => s.due_paisa)),
    todayCollectionPaisa: sum(payments.map((p) => p.amount_paisa)),
    todayExpensePaisa: todayExpense,
    todayProfitPaisa: todaySales - todayExpense,
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
  const ledger = await d.customer_ledger.where('customer_id').equals(customerId).toArray();
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
  name: string; bn_name?: string | null; generic_name?: string | null;
  company?: string | null; type: MedicineType; unit: UnitType;
  low_stock_threshold?: number | null; note?: string | null;
}): Promise<Medicine> {
  if (!input.name?.trim()) throw new Error('ওষুধের নাম দিন');
  const med: Medicine = {
    id: uuid(),
    name: input.name.trim(),
    bn_name: input.bn_name ?? null,
    generic_name: input.generic_name ?? null,
    company: input.company ?? null,
    type: input.type,
    unit: input.unit,
    low_stock_threshold: input.low_stock_threshold ?? null,
    note: input.note ?? null,
    is_active: true,
  };
  const dup = await db().medicines
    .filter((m) => m.name.trim().toLowerCase() === med.name.toLowerCase())
    .first();
  if (dup) throw new Error('এই নামে আগেই একটি ওষুধ আছে');
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
  const meds = await db().medicines.toArray();
  meds.sort((a, b) => a.name.localeCompare(b.name));
  return meds;
}

/** এক ওষুধের সব batch, মেয়াদ অনুসারে (আগে শেষ হবে যেটি, আগে)। */
export async function fetchBatchesForMedicine(medicineId: string): Promise<MedicineBatch[]> {
  const bs = await db().batches.where('medicine_id').equals(medicineId).toArray();
  bs.sort((a, b) => (a.expiry_date ?? '9999-12-31').localeCompare(b.expiry_date ?? '9999-12-31'));
  return bs;
}

/** ওষুধের তথ্য সংশোধন। নাম ফাঁকা বা ডুপ্লিকেট হলে বাতিল; পুরোনো মান audit-এ থাকে। */
export async function updateMedicine(id: string, patch: {
  name?: string; bn_name?: string | null; generic_name?: string | null;
  company?: string | null; type?: MedicineType; unit?: UnitType;
  low_stock_threshold?: number | null; note?: string | null;
}): Promise<Medicine> {
  const d = db();
  const cur = await d.medicines.get(id);
  if (!cur) throw new Error('ওষুধ পাওয়া যায়নি');
  const name = (patch.name ?? cur.name).trim();
  if (!name) throw new Error('ওষুধের নাম দিন');
  const clash = await d.medicines
    .filter((m) => m.id !== id && m.name.trim().toLowerCase() === name.toLowerCase())
    .first();
  if (clash) throw new Error('এই নামে আরেকটি ওষুধ আছে');
  const th = patch.low_stock_threshold;
  if (th != null && (!Number.isFinite(th) || th < 0)) {
    throw new Error('কম স্টকের সীমা ০ বা তার বেশি হতে হবে');
  }
  const next: Medicine = { ...cur, ...patch, name };
  await d.medicines.put(next);
  await audit('medicine', id, 'update', next, cur);
  return next;
}

/** ওষুধ বন্ধ বা চালু। বন্ধ হলে বিক্রয় ও স্টক তালিকায় আসে না, রেকর্ড মুছে যায় না। */
export async function setMedicineActive(id: string, active: boolean): Promise<{ remaining_qty: number }> {
  const d = db();
  const cur = await d.medicines.get(id);
  if (!cur) throw new Error('ওষুধ পাওয়া যায়নি');
  const batches = await d.batches.where('medicine_id').equals(id).toArray();
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
}): Promise<Customer> {
  if (!input.name?.trim()) throw new Error('নাম দিন');
  const c: Customer = {
    id: uuid(),
    name: input.name.trim(),
    phone: input.phone ?? null,
    village: input.village ?? null,
    note: input.note ?? null,
    first_due_date: null,
    last_txn_date: null,
    current_due_paisa: 0,
  };
  await db().customers.add(c);
  await audit('customer', c.id, 'create', { name: c.name });
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
    [d.sales, d.sale_items, d.batches, d.customers, d.customer_ledger, d.audit_logs],
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
          throw new Error(`স্টকে যথেষ্ট নেই (আছে ${batch.qty_in_stock}, চাওয়া ${it.qty})`);
        }
        const line = Math.round(it.unit_price_paisa * it.qty);
        subtotal += line;
        itemRows.push({
          id: uuid(), sale_id: saleId, medicine_id: it.medicine_id, batch_id: batch.id,
          qty: it.qty, unit_price_paisa: it.unit_price_paisa,
          cost_price_paisa: batch.purchase_price_paisa, line_total_paisa: line,
        });
        await d.batches.put({ ...batch, qty_in_stock: batch.qty_in_stock - it.qty });
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
  return d.transaction('rw', [d.batches, d.stock_entries, d.audit_logs], async () => {
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
      created_at: nowISO(),
    });
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
  return d.transaction('rw', [d.batches, d.stock_adjustments, d.audit_logs], async () => {
    const b = await d.batches.get(input.batch_id);
    if (!b) throw new Error('batch পাওয়া যায়নি');
    if (b.qty_in_stock + input.qty < 0) throw new Error('স্টক negative হতে পারবে না');
    await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock + input.qty });
    const id = uuid();
    await d.stock_adjustments.add({
      id, client_txn_id: newClientTxnId('adj'), batch_id: input.batch_id, qty: input.qty,
      reason: input.reason, note: input.note ?? null, adjusted_at: nowISO(),
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
    [d.sales, d.sale_items, d.sale_returns, d.sale_return_items, d.batches, d.customers, d.customer_ledger, d.audit_logs],
    async () => {
      const sale = await d.sales.get(input.sale_id);
      if (!sale) throw new Error('বিক্রয় পাওয়া যায়নি');
      if (sale.status === 'cancelled') throw new Error('বাতিল বিক্রয়ে রিটার্ন হয় না');

      const retId = uuid();
      await d.sale_returns.add({
        id: retId, client_txn_id: newClientTxnId('ret'), sale_id: input.sale_id,
        return_date: todayISO(), refund_paisa: Math.max(0, Math.round(input.refund_paisa || 0)),
        reason: input.reason, created_at: nowISO(),
      });

      let returnedValue = 0;
      for (const it of input.items) {
        if (it.qty <= 0) continue;
        const si = await d.sale_items.get(it.sale_item_id);
        if (!si || si.sale_id !== input.sale_id) throw new Error('বিক্রয় আইটেম পাওয়া যায়নি');
        if (it.qty > si.qty) throw new Error('রিটার্ন পরিমাণ বিক্রীত পরিমাণের বেশি');
        returnedValue += Math.round(si.unit_price_paisa * it.qty);
        await d.sale_return_items.add({
          id: uuid(), return_id: retId, sale_item_id: si.id, batch_id: it.batch_id,
          qty: it.qty, restock: it.restock,
        });
        if (it.restock) {
          const b = await d.batches.get(it.batch_id);
          if (b) await d.batches.put({ ...b, qty_in_stock: b.qty_in_stock + it.qty });
        }
      }

      // বাকিতে বিক্রয় হলে customer balance কমবে (ফেরত মূল্য অনুযায়ী, বর্তমান বাকির মধ্যে)
      if (sale.customer_id && sale.due_paisa > 0) {
        const c = await d.customers.get(sale.customer_id);
        const reduce = Math.min(returnedValue, c?.current_due_paisa ?? 0);
        if (reduce > 0) {
          await d.customer_ledger.add({
            id: uuid(), customer_id: sale.customer_id, entry_type: 'return_adjust',
            amount_paisa: -reduce, ref_sale_id: input.sale_id, note: 'বিক্রয় রিটার্ন', entry_date: nowISO(),
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
    d.cash_sessions.where('session_date').equals(date).first(),
    d.sales.filter((s) => s.status === 'completed' && dateOf(s.sale_date) === date).toArray(),
    d.due_payments.filter((p) => p.status === 'completed' && p.method === 'cash' && p.pay_date === date).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && e.payment_source === 'cash' && e.expense_date === date).toArray(),
    d.stock_entries.filter((e) => e.entry_date === date).toArray(),
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
  const existing = await d.cash_sessions.where('session_date').equals(input.date).first();
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
export interface DailyReport {
  total_sales_paisa: number; cash_sales_paisa: number; due_sales_paisa: number;
  collection_paisa: number; expense_paisa: number; gross_profit_paisa: number;
  net_profit_paisa: number; stock_purchase_paisa: number;
}
export async function fetchDailyReport(date: string): Promise<DailyReport> {
  const d = db();
  const sales = await d.sales.filter((s) => s.status === 'completed' && dateOf(s.sale_date) === date).toArray();
  const saleIds = new Set(sales.map((s) => s.id));
  const [payments, expenses, entries, allItems] = await Promise.all([
    d.due_payments.filter((p) => p.status === 'completed' && p.pay_date === date).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && e.expense_date === date).toArray(),
    d.stock_entries.filter((e) => e.entry_date === date).toArray(),
    d.sale_items.filter((i) => saleIds.has(i.sale_id)).toArray(),
  ]);
  const gross = sum(allItems.map((i) => i.line_total_paisa - Math.round(i.cost_price_paisa * i.qty)));
  const expense = sum(expenses.map((e) => e.amount_paisa));
  return {
    total_sales_paisa: sum(sales.map((s) => s.total_paisa)),
    cash_sales_paisa: sum(sales.map((s) => s.cash_paid_paisa)),
    due_sales_paisa: sum(sales.map((s) => s.due_paisa)),
    collection_paisa: sum(payments.map((p) => p.amount_paisa)),
    expense_paisa: expense,
    gross_profit_paisa: gross,
    net_profit_paisa: gross - expense,
    stock_purchase_paisa: sum(entries.map((e) => Math.round(e.qty * e.purchase_price_paisa))),
  };
}

export interface MonthlyReport {
  total_sales_paisa: number; purchase_cost_paisa: number; gross_profit_paisa: number;
  total_expense_paisa: number; net_profit_paisa: number; new_due_paisa: number;
  collected_due_paisa: number; current_total_due_paisa: number;
  expense_by_category: Record<string, number>;
}
export async function fetchMonthlyReport(year: number, month: number): Promise<MonthlyReport> {
  const d = db();
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 1); // month is 1-based → next month
  const end = endDate.toISOString().slice(0, 10);
  const inRange = (dt: string) => dt >= start && dt < end;

  const sales = await d.sales.filter((s) => s.status === 'completed' && inRange(dateOf(s.sale_date))).toArray();
  const saleIds = new Set(sales.map((s) => s.id));
  const [items, entries, expenses, ledger, payments, customers, cats] = await Promise.all([
    d.sale_items.filter((i) => saleIds.has(i.sale_id)).toArray(),
    d.stock_entries.filter((e) => inRange(e.entry_date)).toArray(),
    d.expenses.filter((e) => e.status === 'completed' && inRange(e.expense_date)).toArray(),
    d.customer_ledger.filter((l) => l.entry_type === 'sale_due' && inRange(dateOf(l.entry_date))).toArray(),
    d.due_payments.filter((p) => p.status === 'completed' && inRange(p.pay_date)).toArray(),
    d.customers.toArray(),
    d.expense_categories.toArray(),
  ]);
  const catMap = new Map(cats.map((c) => [c.id, c.bn_name]));
  const byCat: Record<string, number> = {};
  for (const e of expenses) {
    const k = catMap.get(e.category_id) ?? 'অন্যান্য';
    byCat[k] = (byCat[k] ?? 0) + e.amount_paisa;
  }
  const gross = sum(items.map((i) => i.line_total_paisa - Math.round(i.cost_price_paisa * i.qty)));
  const expense = sum(expenses.map((e) => e.amount_paisa));
  return {
    total_sales_paisa: sum(sales.map((s) => s.total_paisa)),
    purchase_cost_paisa: sum(entries.map((e) => Math.round(e.qty * e.purchase_price_paisa))),
    gross_profit_paisa: gross,
    total_expense_paisa: expense,
    net_profit_paisa: gross - expense,
    new_due_paisa: sum(ledger.map((l) => l.amount_paisa)),
    collected_due_paisa: sum(payments.map((p) => p.amount_paisa)),
    current_total_due_paisa: sum(customers.map((c) => c.current_due_paisa)),
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

// business-rules re-export used only for typing convenience
export { thresholdFor };
