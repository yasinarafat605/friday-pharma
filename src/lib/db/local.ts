'use client';

// সম্পূর্ণ local database (IndexedDB via Dexie) — কোনো cloud/Supabase নেই।
// এই ডিভাইসেই সব ডেটা; সব হিসাব ও নিয়ম client-side transaction-এ enforce হয়।
import Dexie, { type Table } from 'dexie';
import type {
  Medicine, MedicineBatch, Customer,
  MedicineType, UnitType, PaymentType, PaymentMethod,
  TxnStatus, AdjustmentReason, ExpenseSource, ExpenseCategory,
  StockEntry, Sale, SaleItem, CustomerLedger, DuePayment,
  Expense, CashSession, StockAdjustment, SaleReturn, SaleReturnItem,
  AuditLog, AppSettings,
} from '@/types/db';

export const DEFAULT_PHONE = '+8801890163791';

export class LocalDB extends Dexie {
  settings!: Table<AppSettings, string>;
  medicines!: Table<Medicine, string>;
  batches!: Table<MedicineBatch, string>;
  stock_entries!: Table<StockEntry, string>;
  customers!: Table<Customer, string>;
  customer_ledger!: Table<CustomerLedger, string>;
  sales!: Table<Sale, string>;
  sale_items!: Table<SaleItem, string>;
  due_payments!: Table<DuePayment, string>;
  expense_categories!: Table<ExpenseCategory, string>;
  expenses!: Table<Expense, string>;
  cash_sessions!: Table<CashSession, string>;
  stock_adjustments!: Table<StockAdjustment, string>;
  sale_returns!: Table<SaleReturn, string>;
  sale_return_items!: Table<SaleReturnItem, string>;
  audit_logs!: Table<AuditLog, string>;

  constructor() {
    super('asshifa_local');
    this.version(1).stores({
      settings: 'id',
      medicines: 'id, name, generic_name, company, type, is_active',
      batches: 'id, medicine_id, expiry_date, qty_in_stock',
      stock_entries: 'id, batch_id, entry_date, client_txn_id',
      customers: 'id, name, phone, village, current_due_paisa',
      customer_ledger: 'id, customer_id, entry_date',
      sales: 'id, txn_no, sale_date, customer_id, status, client_txn_id',
      sale_items: 'id, sale_id, medicine_id, batch_id',
      due_payments: 'id, customer_id, pay_date, method, status, client_txn_id',
      expense_categories: 'id, name, sort_order',
      expenses: 'id, category_id, expense_date, payment_source, status, client_txn_id',
      cash_sessions: 'id, session_date',
      stock_adjustments: 'id, batch_id, adjusted_at, client_txn_id',
      sale_returns: 'id, sale_id, return_date, client_txn_id',
      sale_return_items: 'id, return_id, sale_item_id, batch_id',
      audit_logs: 'id, entity, created_at',
    });
  }
}

let _db: LocalDB | null = null;
export function db(): LocalDB {
  if (typeof window === 'undefined') throw new Error('LocalDB শুধু browser-এ');
  if (!_db) _db = new LocalDB();
  return _db;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * স্থানীয় দিনপঞ্জির তারিখ (YYYY-MM-DD)।
 * ISO/UTC ব্যবহার করলে বাংলাদেশে (UTC+৬) রাত ১২টা থেকে ভোর ৬টার লেনদেন
 * আগের দিনে চলে যেত — তাই এখানে ফোনের নিজের তারিখ ব্যবহার হয়।
 */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** কোনো সংরক্ষিত ISO সময়কে স্থানীয় তারিখে রূপান্তর। */
export function localDateOf(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? localDate(d) : iso.slice(0, 10);
}

export function todayISO(): string {
  return localDate();
}

/** unique client transaction id — duplicate submission রোধ। */
export function newClientTxnId(prefix = 'txn'): string {
  return `${prefix}_${Date.now()}_${uuid()}`;
}

function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'DEV';
  let id = localStorage.getItem('asshifa_device');
  if (!id) {
    id = Math.random().toString(36).slice(2, 6).toUpperCase();
    localStorage.setItem('asshifa_device', id);
  }
  return id;
}

/** device-prefixed txn_no — collision রোধ। */
export function newTxnNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = Math.floor(Math.random() * 9000 + 1000);
  return `S-${getDeviceId()}-${ymd}-${rnd}`;
}

// ---------- Audit ----------
export async function audit(entity: string, entity_id: string, action: string, newValue?: unknown, oldValue?: unknown) {
  await db().audit_logs.add({
    id: uuid(),
    entity, entity_id, action,
    old_value: oldValue ?? null,
    new_value: newValue ?? null,
    device: getDeviceId(),
    created_at: nowISO(),
  });
}

// ---------- First-run seed ----------
const DEFAULT_CATEGORIES: { name: string; bn_name: string; is_recurring: boolean; sort_order: number }[] = [
  { name: 'shop_rent', bn_name: 'দোকান ভাড়া', is_recurring: true, sort_order: 1 },
  { name: 'electricity', bn_name: 'বিদ্যুৎ বিল', is_recurring: true, sort_order: 2 },
  { name: 'hospitality', bn_name: 'মেহমানদারি', is_recurring: false, sort_order: 3 },
  { name: 'tea_snacks', bn_name: 'চা ও নাস্তা', is_recurring: false, sort_order: 4 },
  { name: 'travel', bn_name: 'যাতায়াত', is_recurring: false, sort_order: 5 },
  { name: 'transport', bn_name: 'পরিবহন', is_recurring: false, sort_order: 6 },
  { name: 'cleaning', bn_name: 'দোকান পরিষ্কার', is_recurring: false, sort_order: 7 },
  { name: 'repair', bn_name: 'দোকান মেরামত', is_recurring: false, sort_order: 8 },
  { name: 'bags', bn_name: 'ব্যাগ বা প্যাকেট', is_recurring: false, sort_order: 9 },
  { name: 'mobile_internet', bn_name: 'মোবাইল বা ইন্টারনেট', is_recurring: false, sort_order: 10 },
  { name: 'license_fee', bn_name: 'লাইসেন্স বা ফি', is_recurring: false, sort_order: 11 },
  { name: 'others', bn_name: 'অন্যান্য', is_recurring: false, sort_order: 99 },
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  pharmacy_name: 'আশ শিফা ফার্মেসী',
  owner_name: null,
  phone: DEFAULT_PHONE,
  address: null,
  currency: 'BDT',
  locale: 'bn',
  auto_lock_minutes: 3,
  low_stock_syrup: 1,
  low_stock_tablet: 10,
  low_stock_capsule: 10,
  expiry_alert_days: 90,
  last_backup_at: null,
  backup_reminder_days: 7,
};

/** প্রথমবার settings ও খরচ ক্যাটাগরি তৈরি (idempotent)। */
export async function ensureSeeded(): Promise<void> {
  const d = db();
  const s = await d.settings.get('app');
  if (!s) await d.settings.add({ ...DEFAULT_SETTINGS });
  const count = await d.expense_categories.count();
  if (count === 0) {
    await d.expense_categories.bulkAdd(
      DEFAULT_CATEGORIES.map((c) => ({ id: uuid(), ...c })),
    );
  }
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSeeded();
  const stored = await db().settings.get('app');
  // পুরোনো ডিভাইসে সংরক্ষিত settings-এ নতুন ফিল্ড না থাকলে default দিয়ে পূরণ হয়।
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}), id: 'app' };
}

// ---------- সম্পূর্ণ ডেটা export/import (ব্যাকআপ) ----------
const ALL_TABLES = [
  'settings', 'medicines', 'batches', 'stock_entries', 'customers', 'customer_ledger',
  'sales', 'sale_items', 'due_payments', 'expense_categories', 'expenses',
  'cash_sessions', 'stock_adjustments', 'sale_returns', 'sale_return_items', 'audit_logs',
] as const;

export interface BackupDump {
  app: 'asshifa';
  version: number;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupDump> {
  const d = db();
  const tables: Record<string, unknown[]> = {};
  for (const t of ALL_TABLES) {
    tables[t] = await (d as unknown as Record<string, { toArray: () => Promise<unknown[]> }>)[t].toArray();
  }
  return { app: 'asshifa', version: 1, exported_at: nowISO(), tables };
}

/** dump-এ কতগুলো রেকর্ড আছে (restore preview-এর জন্য)। */
export function countRecords(dump: BackupDump): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(dump.tables)) out[k] = Array.isArray(v) ? v.length : 0;
  return out;
}

export async function importAll(dump: BackupDump): Promise<void> {
  if (dump.app !== 'asshifa' || !dump.tables) throw new Error('অবৈধ ব্যাকআপ ফাইল');
  const d = db();
  await d.transaction('rw', d.tables, async () => {
    for (const t of ALL_TABLES) {
      const table = (d as unknown as Record<string, { clear: () => Promise<void>; bulkAdd: (x: unknown[]) => Promise<unknown> }>)[t];
      await table.clear();
      const rows = dump.tables[t];
      if (Array.isArray(rows) && rows.length) await table.bulkAdd(rows);
    }
  });
}

// re-export common types used by callers
export type {
  MedicineType, UnitType, PaymentType, PaymentMethod,
  TxnStatus, AdjustmentReason, ExpenseSource,
};
