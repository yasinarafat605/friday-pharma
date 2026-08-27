import { describe, it, expect } from 'vitest';
import {
  stockStatus, thresholdFor, expiryStatus, isExpired,
  validateDuePayment, validateSaleQty, sortBatchesFEFO,
} from '@/lib/business-rules';

const TODAY = new Date('2026-07-14T00:00:00');

describe('low-stock rules (Section ১৮)', () => {
  it('syrup ≤ 1 → low', () => {
    expect(stockStatus(1, 'syrup')).toBe('low');
    expect(stockStatus(2, 'syrup')).toBe('normal');
    expect(stockStatus(0, 'syrup')).toBe('out');
  });
  it('tablet/capsule ≤ 10 → low', () => {
    expect(stockStatus(8, 'tablet')).toBe('low');
    expect(stockStatus(10, 'capsule')).toBe('low');
    expect(stockStatus(11, 'tablet')).toBe('normal');
  });
  it('threshold override respected', () => {
    expect(thresholdFor('tablet', 20)).toBe(20);
    expect(thresholdFor('syrup')).toBe(1);
  });
});

describe('expiry rules (Section ৫)', () => {
  it('past date → expired, blocked from sale', () => {
    expect(expiryStatus('2026-07-13', TODAY)).toBe('expired');
    expect(isExpired('2026-07-13', TODAY)).toBe(true);
  });
  it('90/60/30 day windows', () => {
    expect(expiryStatus('2026-08-01', TODAY)).toBe('d30');
    expect(expiryStatus('2026-09-01', TODAY)).toBe('d60');
    expect(expiryStatus('2026-10-01', TODAY)).toBe('d90');
    expect(expiryStatus('2027-01-01', TODAY)).toBe('ok');
  });
});

describe('due payment (rule 6)', () => {
  it('overpayment rejected', () => {
    expect(validateDuePayment(5000, 3000)).toMatch(/বেশি/);
  });
  it('zero/negative rejected', () => {
    expect(validateDuePayment(0, 3000)).toBeTruthy();
  });
  it('valid payment ok', () => {
    expect(validateDuePayment(3000, 3000)).toBeNull();
  });
});

describe('sale qty (rules 1,7)', () => {
  it('cannot exceed stock', () => {
    expect(validateSaleQty(5, 3)).toMatch(/যথেষ্ট নেই/);
  });
  it('valid ok', () => {
    expect(validateSaleQty(2, 3)).toBeNull();
  });
});

describe('FEFO ordering', () => {
  it('nearest expiry first, expired excluded', () => {
    const batches = [
      { expiry_date: '2027-01-01', qty_in_stock: 5 },
      { expiry_date: '2026-08-01', qty_in_stock: 3 },
      { expiry_date: '2026-07-13', qty_in_stock: 9 }, // expired
      { expiry_date: '2026-12-01', qty_in_stock: 2 },
    ];
    const sorted = sortBatchesFEFO(batches, TODAY);
    expect(sorted.map((b) => b.expiry_date)).toEqual(['2026-08-01', '2026-12-01', '2027-01-01']);
  });
});
