import { describe, it, expect } from 'vitest';
import { backupStatus } from '@/lib/business-rules';

const NOW = new Date('2026-08-27T10:00:00');

describe('backup reminder rules', () => {
  it('কখনো ব্যাকআপ না নিলে overdue', () => {
    const s = backupStatus(null, 7, NOW);
    expect(s.never).toBe(true);
    expect(s.overdue).toBe(true);
    expect(s.daysSince).toBeNull();
  });

  it('অবৈধ তারিখকেও ব্যাকআপ নেই ধরা হয়', () => {
    expect(backupStatus('not-a-date', 7, NOW).never).toBe(true);
  });

  it('সাম্প্রতিক ব্যাকআপ overdue নয়', () => {
    const s = backupStatus('2026-08-25T10:00:00', 7, NOW);
    expect(s.never).toBe(false);
    expect(s.daysSince).toBe(2);
    expect(s.overdue).toBe(false);
  });

  it('ঠিক সীমার দিনে overdue হয়', () => {
    const s = backupStatus('2026-08-20T10:00:00', 7, NOW);
    expect(s.daysSince).toBe(7);
    expect(s.overdue).toBe(true);
  });

  it('সীমার এক দিন আগে overdue নয়', () => {
    expect(backupStatus('2026-08-21T10:00:00', 7, NOW).overdue).toBe(false);
  });

  it('ব্যবহারকারীর নিজের সীমা মানা হয়', () => {
    const last = '2026-08-25T10:00:00';
    expect(backupStatus(last, 2, NOW).overdue).toBe(true);
    expect(backupStatus(last, 30, NOW).overdue).toBe(false);
  });

  it('সীমা ০ বা negative হলে অন্তত ১ দিন ধরা হয়', () => {
    expect(backupStatus('2026-08-27T09:00:00', 0, NOW).overdue).toBe(false);
    expect(backupStatus('2026-08-26T09:00:00', 0, NOW).overdue).toBe(true);
  });

  it('ভবিষ্যতের তারিখে daysSince negative হয় না', () => {
    const s = backupStatus('2026-09-01T10:00:00', 7, NOW);
    expect(s.daysSince).toBe(0);
    expect(s.overdue).toBe(false);
  });
});
