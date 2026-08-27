// ব্যবসায়িক নিয়ম (Section ১৮) — client-side গণনা ও সতর্কতা।
// চূড়ান্ত enforcement server (Postgres RPC/constraint)-এ; এটি UI feedback ও offline calc-এর জন্য।

import type { Paisa } from './money';

export type StockStatus = 'out' | 'low' | 'normal';
export type ExpiryStatus = 'expired' | 'd30' | 'd60' | 'd90' | 'ok' | 'unknown';

export const DEFAULT_THRESHOLD: Record<string, number> = {
  syrup: 1,
  tablet: 10,
  capsule: 10,
};

export function thresholdFor(type: string, override?: number | null): number {
  if (override != null) return override;
  return DEFAULT_THRESHOLD[type] ?? 5;
}

export function stockStatus(qty: number, type: string, override?: number | null): StockStatus {
  if (qty <= 0) return 'out';
  if (qty <= thresholdFor(type, override)) return 'low';
  return 'normal';
}

/** সতর্কতা: ৯০/৬০/৩০ দিন ও expired (Section ৫)। */
export function expiryStatus(expiry?: string | null, today = new Date()): ExpiryStatus {
  if (!expiry) return 'unknown';
  const d = new Date(expiry + 'T00:00:00');
  const days = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  if (days <= 90) return 'd90';
  return 'ok';
}

export function isExpired(expiry?: string | null, today = new Date()): boolean {
  return expiryStatus(expiry, today) === 'expired';
}

/** UI রঙ: কম স্টক = কমলা, শেষ = লাল, স্বাভাবিক = সবুজ */
export function stockColorClass(s: StockStatus): string {
  return s === 'out' ? 'badge-danger' : s === 'low' ? 'badge-low' : 'badge-normal';
}

/** বাকি আদায়: overpayment রোধ (নিয়ম ৬)। */
export function validateDuePayment(amountPaisa: Paisa, currentDuePaisa: Paisa): string | null {
  if (amountPaisa <= 0) return 'পরিশোধের পরিমাণ ০-এর বেশি হতে হবে';
  if (amountPaisa > currentDuePaisa) return 'পরিশোধ বর্তমান বাকি থেকে বেশি হতে পারবে না';
  return null;
}

/** বিক্রয়ে stock-এর বেশি বিক্রি রোধ (নিয়ম ১, ৭)। */
export function validateSaleQty(qty: number, available: number): string | null {
  if (qty <= 0) return 'পরিমাণ ০-এর বেশি হতে হবে';
  if (qty > available) return `স্টকে যথেষ্ট নেই (আছে ${available})`;
  return null;
}

/** FEFO: কাছাকাছি expiry batch আগে (Section ৫)। */
export function sortBatchesFEFO<T extends { expiry_date?: string | null; qty_in_stock: number }>(
  batches: T[],
): T[] {
  return [...batches]
    .filter((b) => b.qty_in_stock > 0 && !isExpired(b.expiry_date))
    .sort((a, b) => {
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date.localeCompare(b.expiry_date);
    });
}
