// অ্যাপ-জুড়ে ব্যবহৃত ধরন। সব ডেটা local (IndexedDB)। সব টাকা integer paisa।

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

export interface AppSettings {
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

export interface Medicine {
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

export interface MedicineBatch {
  id: string;
  medicine_id: string;
  batch_no?: string | null;
  expiry_date?: string | null;
  purchase_price_paisa: number;
  sale_price_paisa: number;
  qty_in_stock: number;
}

export interface StockEntry {
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

export interface Customer {
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

export interface CustomerLedger {
  id: string;
  customer_id: string;
  entry_type: LedgerType;
  amount_paisa: number; // + বাড়ায় (due), − কমায় (payment/return)
  ref_sale_id?: string | null;
  ref_payment_id?: string | null;
  note?: string | null;
  entry_date: string;
}

export interface Sale {
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

export interface SaleItem {
  id: string;
  sale_id: string;
  medicine_id: string;
  batch_id: string;
  qty: number;
  unit_price_paisa: number;
  cost_price_paisa: number;
  line_total_paisa: number;
}

export interface DuePayment {
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

export interface ExpenseCategory {
  id: string;
  name: string;
  bn_name: string;
  is_recurring: boolean;
  sort_order: number;
}

export interface Expense {
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

export interface CashSession {
  id: string;
  session_date: string;
  opening_cash_paisa: number;
  actual_closing_paisa?: number | null;
  note?: string | null;
}

export interface StockAdjustment {
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

export interface SaleReturn {
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

export interface SaleReturnItem {
  id: string;
  return_id: string;
  sale_item_id: string;
  batch_id: string;
  qty: number;
  restock: boolean;
}

export interface AuditLog {
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
