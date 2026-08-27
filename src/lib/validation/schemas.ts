// Zod schemas — client-side validation (server RPC/constraint চূড়ান্ত)।
import { z } from 'zod';

const paisa = z.number().int().nonnegative();

export const medicineSchema = z.object({
  name: z.string().min(1, 'ওষুধের নাম দিন'),
  bn_name: z.string().optional().nullable(),
  generic_name: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  type: z.enum([
    'syrup', 'tablet', 'capsule', 'injection',
    'drop', 'cream', 'powder', 'saline', 'other',
  ]),
  unit: z.enum(['piece', 'bottle', 'packet', 'tube', 'vial', 'sachet', 'box']),
  low_stock_threshold: z.number().int().nonnegative().optional().nullable(),
  note: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});

export const addStockSchema = z.object({
  medicine_id: z.string().uuid('ওষুধ নির্বাচন করুন'),
  batch_no: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  qty: z.number().positive('পরিমাণ ০-এর বেশি হতে হবে'),
  purchase_price_paisa: paisa,
  sale_price_paisa: paisa,
  entry_date: z.string(),
  invoice_no: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export const saleItemSchema = z.object({
  medicine_id: z.string().uuid(),
  batch_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_price_paisa: paisa,
});

export const saleSchema = z
  .object({
    customer_id: z.string().uuid().optional().nullable(),
    discount_paisa: paisa.default(0),
    payment_type: z.enum(['cash', 'due', 'mixed']),
    cash_paid_paisa: paisa.default(0),
    items: z.array(saleItemSchema).min(1, 'অন্তত একটি ওষুধ দিন'),
    note: z.string().optional().nullable(),
  })
  .refine((v) => (v.payment_type === 'cash' ? true : !!v.customer_id), {
    message: 'বাকি/মিশ্র বিক্রয়ে পাওনাদার নির্বাচন করুন',
    path: ['customer_id'],
  });

export const customerSchema = z.object({
  name: z.string().min(1, 'নাম দিন'),
  phone: z.string().optional().nullable(),
  village: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export const duePaymentSchema = z.object({
  customer_id: z.string().uuid('পাওনাদার নির্বাচন করুন'),
  amount_paisa: z.number().int().positive('পরিমাণ ০-এর বেশি হতে হবে'),
  method: z.enum(['cash', 'bkash', 'nagad', 'rocket', 'other']),
  pay_date: z.string(),
  note: z.string().optional().nullable(),
});

export const expenseSchema = z.object({
  category_id: z.string().uuid('ক্যাটাগরি নির্বাচন করুন'),
  amount_paisa: z.number().int().positive('পরিমাণ ০-এর বেশি হতে হবে'),
  expense_date: z.string(),
  description: z.string().optional().nullable(),
  payment_source: z.enum(['cash', 'bkash', 'nagad', 'rocket', 'bank', 'other']),
});

export type MedicineInput = z.infer<typeof medicineSchema>;
export type AddStockInput = z.infer<typeof addStockSchema>;
export type SaleInput = z.infer<typeof saleSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type DuePaymentInput = z.infer<typeof duePaymentSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
