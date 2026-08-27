import { describe, it, expect } from 'vitest';
import { localDate, localDateOf } from '@/lib/db/local';

/** মাসিক রিপোর্টের সীমা — data.ts-এর মতো একই নিয়মে তৈরি। */
function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end, inRange: (d: string) => d >= start && d < end };
}

describe('মাসিক রিপোর্টের সীমা', () => {
  it('৩১ দিনের মাসে শেষ দিনও ধরা হয়', () => {
    const r = monthRange(2026, 8);
    expect(r.inRange('2026-08-01')).toBe(true);
    expect(r.inRange('2026-08-31')).toBe(true);
    expect(r.inRange('2026-09-01')).toBe(false);
    expect(r.inRange('2026-07-31')).toBe(false);
  });

  it('৩০ দিনের মাসে শেষ দিনও ধরা হয়', () => {
    const r = monthRange(2026, 9);
    expect(r.inRange('2026-09-30')).toBe(true);
    expect(r.inRange('2026-10-01')).toBe(false);
  });

  it('ফেব্রুয়ারি ও অধিবর্ষ', () => {
    expect(monthRange(2026, 2).inRange('2026-02-28')).toBe(true);
    expect(monthRange(2028, 2).inRange('2028-02-29')).toBe(true);
    expect(monthRange(2026, 2).inRange('2026-03-01')).toBe(false);
  });

  it('ডিসেম্বরে বছর বদলায়', () => {
    const r = monthRange(2026, 12);
    expect(r.end).toBe('2027-01-01');
    expect(r.inRange('2026-12-31')).toBe(true);
    expect(r.inRange('2027-01-01')).toBe(false);
  });
});

describe('স্থানীয় দিনপঞ্জির তারিখ', () => {
  it('মধ্যরাতের পরের লেনদেন সেদিনেরই থাকে', () => {
    // বাংলাদেশে (UTC+৬) UTC ব্যবহার করলে এটি আগের দিনে চলে যেত।
    expect(localDate(new Date(2026, 7, 28, 0, 30))).toBe('2026-08-28');
    expect(localDate(new Date(2026, 7, 28, 5, 30))).toBe('2026-08-28');
  });

  it('রাত ১১টার লেনদেনও সেদিনের', () => {
    expect(localDate(new Date(2026, 7, 28, 23, 30))).toBe('2026-08-28');
  });

  it('মাসের ও বছরের শেষ দিন ঠিক থাকে', () => {
    expect(localDate(new Date(2026, 7, 31, 23, 59))).toBe('2026-08-31');
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('সংরক্ষিত ISO সময় স্থানীয় তারিখে রূপ নেয়', () => {
    const iso = new Date(2026, 7, 28, 1, 0).toISOString();
    expect(localDateOf(iso)).toBe('2026-08-28');
  });

  it('ফাঁকা বা ভুল মান ভাঙে না', () => {
    expect(localDateOf('')).toBe('');
    expect(localDateOf('2026-08-28')).toBe('2026-08-28');
  });
});
