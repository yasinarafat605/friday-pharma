// অ্যাপ-জুড়ে ব্যবহৃত ধরন। সব ডেটা local (IndexedDB)। সব টাকা integer paisa।

/**
 * প্রতিটি রেকর্ডে থাকা সিঙ্ক-সংক্রান্ত ফিল্ড।
 * pharmacy_id — কোন ফার্মেসির রেকর্ড (এক ফার্মেসির ডেটা অন্য কেউ দেখবে না)।
 * updated_at  — শেষ কবে বদলেছে; সার্ভারে কী পাঠাতে হবে তা এখান থেকেই ঠিক হয়।
 * deleted_at  — মুছে ফেলা রেকর্ড সত্যিই মোছা হয় না, চিহ্ন দেওয়া হয়, যাতে
 *               মুছে ফেলার খবরটিও অন্য ডিভাইসে পৌঁছায়।
 * dirty       — ১ হলে সারিটি এখনো সার্ভারে পাঠানো হয়নি। সিঙ্ক ইঞ্জিন
 *               পাঠানোর পর ০ বসায়। কোনটা পাঠাতে হবে তা এখান থেকেই ঠিক হয়,
 *               সময় মিলিয়ে নয় — নইলে সার্ভার থেকে নামানো সারিও বদলেছে মনে হতো।
 */
export interface SyncFields {
  pharmacy_id?: string;
  updated_at?: string;
  deleted_at?: string | null;
  dirty?: 0 | 1;
}

/** প্রতি টেবিলে সিঙ্ক কতদূর এগিয়েছে। এই সারিগুলো নিজে সিঙ্ক হয় না। */
export interface SyncState {
  table_name: string;
  last_pulled_at?: string | null;
  last_pushed_at?: string | null;
  last_error?: string | null;
}

/** যে সারিগুলো পাঠানো যায়নি — কতবার চেষ্টা হয়েছে ও পরে কখন আবার হবে। */
export interface SyncFailure {
  id: string;
  table_name: string;
  row_id: string;
  attempts: number;
  last_error: string;
  next_retry_at: string;
  created_at: string;
}

export type MedicineType =
  | 'syrup' | 'tablet' | 'capsule' | 'injection'
  | 'drop' | 'cream' | 'powder' | 'saline' | 'other';

export type UnitType =
  | 'piece' | 'bottle' | 'packet' | 'tube' | 'vial' | 'sachet' | 'box';

export type PaymentType = 'cash' | 'due' | 'mixed';
export type PaymentMethod = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'other';
export type TxnStatus = 'completed' | 'cancelled';
export type AdjustmentReason =
  | 'expired' | 'damaged' | 'broken' | 'lost'
  | 'personal_use' | 'wrong_entry' | 'other';
export type ExpenseSource = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'bank' | 'other';
export type LedgerType = 'opening' | 'sale_due' | 'payment' | 'return_adjust';

export interface AppSettings extends SyncFields {
  id: 'app';
  pharmacy_name: string;
  owner_name?: string | null;
  phone?: string | null;
  address?: string | null;
  currency: string;
  locale: 'bn' | 'en';
  auto_lock_minutes: number;
  low_stock_syrup: number;
  low_stock_tablet: number;
  low_stock_capsule: number;
  expiry_alert_days: number;
  /** সর্বশেষ সফল ব্যাকআপের সময় (ISO)। কখনো না নিলে null। */
  last_backup_at?: string | null;
  /** কত দিন পর ব্যাকআপ মনে করিয়ে দেবে। */
  backup_reminder_days: number;
}

export interface Medicine extends SyncFields {
  id: string;
  name: string;
  bn_name?: string | null;
  /** পাওয়ার, যেমন "500 mg" বা "120 mg/5 ml"। পুরোনো রেকর্ডে না থাকতে পারে। */
  strength?: string | null;
  generic_name?: string | null;
  company?: string | null;
  type: MedicineType;
  unit: UnitType;
  low_stock_threshold?: number | null;
  note?: string | null;
  is_active: boolean;
}

export interface MedicineBatch extends SyncFields {
  id: string;
  medicine_id: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  purchase_price_paisa: number;
  sale_price_paisa: number;
  qty_in_stock: number;
}

export interface StockEntry extends SyncFields {
  id: string;
  client_txn_id: string;
  batch_id: string;
  qty: number;
  purchase_price_paisa: number;
  sale_price_paisa: number;
  entry_date: string;
  invoice_no?: string | null;
  note?: string | null;
  created_at: string;
  /** পুরোনো রেকর্ডে না থাকলে completed ধরা হয়। */
  status?: TxnStatus;
  cancelled_reason?: string | null;
}

export interface Customer extends SyncFields {
  id: string;
  name: string;
  phone?: string | null;
  village?: string | null;
  photo_url?: string | null;
  note?: string | null;
  first_due_date?: string | null;
  last_txn_date?: string | null;
  current_due_paisa: number;
}

export interface CustomerLedger extends SyncFields {
  id: string;
  customer_id: string;
  entry_type: LedgerType;
  amount_paisa: number; // + বাড়ায় (due), − কমায় (payment/return)
  ref_sale_id?: string | null;
  ref_payment_id?: string | null;
  /** কোন রিটার্নের জন্য এই সমন্বয় — একাধিক রিটার্ন আলাদা রাখতে। */
  ref_return_id?: string | null;
  note?: string | null;
  entry_date: string;
}

export interface Sale extends SyncFields {
  id: string;
  client_txn_id: string;
  txn_no: string;
  sale_date: string;
  customer_id?: string | null;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  payment_type: PaymentType;
  cash_paid_paisa: number;
  due_paisa: number;
  status: TxnStatus;
  cancelled_reason?: string | null;
  note?: string | null;
}

export interface SaleItem extends SyncFields {
  id: string;
  sale_id: string;
  medicine_id: string;
  batch_id: string;
  qty: number;
  unit_price_paisa: number;
  cost_price_paisa: number;
  line_total_paisa: number;
}

export interface DuePayment extends SyncFields {
  id: string;
  client_txn_id: string;
  receipt_ref: string;
  customer_id: string;
  pay_date: string;
  amount_paisa: number;
  method: PaymentMethod;
  status: TxnStatus;
  note?: string | null;
}

export interface ExpenseCategory extends SyncFields {
  id: string;
  name: string;
  bn_name: string;
  is_recurring: boolean;
  sort_order: number;
}

export interface Expense extends SyncFields {
  id: string;
  client_txn_id: string;
  expense_date: string;
  category_id: string;
  amount_paisa: number;
  description?: string | null;
  receipt_url?: string | null;
  payment_source: ExpenseSource;
  status: TxnStatus;
}

export interface CashSession extends SyncFields {
  id: string;
  session_date: string;
  opening_cash_paisa: number;
  actual_closing_paisa?: number | null;
  note?: string | null;
}

/** স্টক কেন নড়ল। */
export type MovementReason =
  | 'opening_balance'   // অ্যাপ শুরুর আগের বা মেলাতে না পারা পরিমাণ
  | 'purchase'          // নতুন স্টক এসেছে
  | 'sale'              // বিক্রি হয়েছে
  | 'adjustment'        // নষ্ট, হারানো, ভুল সংশোধন
  | 'return'            // গ্রাহক ফেরত দিয়েছেন, স্টকে ফিরেছে
  | 'write_off'         // মেয়াদ শেষ, বাদ দেওয়া হয়েছে
  | 'reversal';         // উপরের কোনো কিছু বাতিল হয়েছে

/**
 * স্টকের প্রতিটি নড়াচড়া — শুধু যোগ হয়, কখনো বদলায় না, কখনো মোছে না।
 *
 * ব্যাচের পরিমাণ আর সরাসরি বদলানো হয় না; এই সারিগুলো যোগ করে বের হয়।
 * কারণ দুটি ডিভাইস অফলাইনে থাকলে দুজনেই পুরো সংখ্যাটি লিখত এবং একজনের
 * বিক্রয় নিঃশব্দে হারিয়ে যেত। আলাদা আলাদা নড়াচড়া কখনো একে অপরকে মোছে না।
 */
export interface StockMovement extends SyncFields {
  id: string;
  batch_id: string;
  medicine_id: string;
  /** চিহ্নসহ: বিক্রয়ে ঋণাত্মক, ক্রয়ে ধনাত্মক। */
  qty_delta: number;
  reason: MovementReason;
  /** কোন রেকর্ডের কারণে — যেমন 'sale_item', 'stock_entry'। */
  ref_type?: string | null;
  ref_id?: string | null;
  /** স্থানীয় দিনপঞ্জির তারিখ, রিপোর্টের জন্য। */
  business_date: string;
  created_at: string;
  client_txn_id: string;
  note?: string | null;
}

export interface StockAdjustment extends SyncFields {
  id: string;
  client_txn_id: string;
  batch_id: string;
  qty: number;
  reason: AdjustmentReason;
  note?: string | null;
  adjusted_at: string;
  status?: TxnStatus;
  cancelled_reason?: string | null;
}

export interface SaleReturn extends SyncFields {
  id: string;
  client_txn_id: string;
  sale_id: string;
  return_date: string;
  refund_paisa: number;
  reason: string;
  created_at: string;
  status?: TxnStatus;
  cancelled_reason?: string | null;
}

export interface SaleReturnItem extends SyncFields {
  id: string;
  return_id: string;
  sale_item_id: string;
  batch_id: string;
  qty: number;
  restock: boolean;
}

export interface AuditLog extends SyncFields {
  id: string;
  entity: string;
  entity_id: string;
  action: string;
  old_value?: unknown;
  new_value?: unknown;
  device?: string;
  created_at: string;
}

// ---- UI helper types ----
export interface SaleItemInput {
  medicine_id: string;
  batch_id: string;
  qty: number;
  unit_price_paisa: number;
}

export interface StockRow {
  batch_id: string;
  medicine_id: string;
  name: string;
  bn_name?: string | null;
  strength?: string | null;
  generic_name?: string | null;
  company?: string | null;
  type: MedicineType;
  unit: UnitType;
  batch_no?: string | null;
  expiry_date?: string | null;
  qty_in_stock: number;
  purchase_price_paisa: number;
  sale_price_paisa: number;
  threshold: number;
  stock_status: 'out' | 'low' | 'normal';
  expiry_status: string | null;
}

// ---- সদস্যপদ ও ভূমিকা (RBAC) ----
export type MemberRole = 'owner' | 'manager' | 'cashier' | 'inventory' | 'accountant';

export interface Pharmacy {
  id: string;
  name: string;
  created_by: string;
  is_active?: boolean;
  plan?: 'trial' | 'pro' | 'enterprise';
  trial_ends_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Membership {
  user_id: string;
  pharmacy_id: string;
  role: MemberRole;
  is_default: boolean;
  full_name?: string | null;
  phone?: string | null;
  joined_at?: string;
  updated_at?: string;
  pharmacies?: {
    id: string;
    name: string;
    created_by?: string;
  };
}

export interface Invite {
  code: string;
  pharmacy_id: string;
  role: MemberRole;
  created_by?: string;
  created_at?: string;
  expires_at?: string;
  used_by?: string | null;
  used_at?: string | null;
}

export interface InvitePreview {
  pharmacy_id: string;
  pharmacy_name: string;
  role: MemberRole;
}

