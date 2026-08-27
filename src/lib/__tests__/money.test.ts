import { describe, it, expect } from 'vitest';
import { takaToPaisa, paisaToTaka, formatTaka, toBanglaDigits, addPaisa } from '@/lib/money';

describe('money (integer paisa)', () => {
  it('takaToPaisa rounds correctly (no float error)', () => {
    expect(takaToPaisa(10)).toBe(1000);
    expect(takaToPaisa(10.5)).toBe(1050);
    expect(takaToPaisa('12.34')).toBe(1234);
    expect(takaToPaisa(0.1 + 0.2)).toBe(30); // 0.30000000004 → 30
  });

  it('paisaToTaka inverse', () => {
    expect(paisaToTaka(1234)).toBe(12.34);
    expect(paisaToTaka(1000)).toBe(10);
  });

  it('addPaisa stays integer', () => {
    expect(addPaisa(1050, 1234, 30)).toBe(2314);
  });

  it('formatTaka renders Bangla digits with symbol', () => {
    expect(formatTaka(123456)).toBe('১,২৩৪.৫৬ ৳');
    expect(formatTaka(1000, { symbol: false })).toBe('১০.০০');
  });

  it('toBanglaDigits', () => {
    expect(toBanglaDigits('2026-07-14')).toBe('২০২৬-০৭-১৪');
  });
});
