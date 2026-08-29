import { describe, it, expect } from 'vitest';
import { stampCreate, stampUpdate } from '@/lib/db/stamp';
import { selectCheckpointsToPrune, verifyCheckpoint, type Checkpoint } from '@/lib/db/checkpoint';
import { retryDelaySeconds, shouldRetry, nextRetryAt } from '@/lib/sync/state';

const PH = 'pharmacy-1';
const NOW = '2026-08-27T10:00:00.000Z';

describe('নতুন সারিতে ফিল্ড বসানো', () => {
  it('অ্যাপের সাধারণ লেখায় সব ফিল্ড বসে ও সারিটি পাঠানোর তালিকায় যায়', () => {
    const row: Record<string, unknown> = { id: 'a', name: 'Napa' };
    stampCreate(row, PH, NOW);
    expect(row.pharmacy_id).toBe(PH);
    expect(row.updated_at).toBe(NOW);
    expect(row.deleted_at).toBeNull();
    expect(row.dirty).toBe(1);
  });

  it('সিঙ্ক ইঞ্জিন যা দেয় তা অক্ষত থাকে', () => {
    const row: Record<string, unknown> = {
      id: 'a', pharmacy_id: 'other', updated_at: '2026-01-01T00:00:00.000Z', dirty: 0,
    };
    stampCreate(row, PH, NOW);
    expect(row.pharmacy_id).toBe('other');
    expect(row.updated_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row.dirty).toBe(0);
  });

  it('deleted_at স্পষ্টভাবে দেওয়া থাকলে বদলায় না', () => {
    const row: Record<string, unknown> = { id: 'a', deleted_at: NOW };
    stampCreate(row, PH, NOW);
    expect(row.deleted_at).toBe(NOW);
  });
});

describe('সারি বদলানোর সময় ফিল্ড বসানো', () => {
  it('অ্যাপ কিছু বদলালে সময় বসে ও সারিটি আবার পাঠানোর তালিকায় যায়', () => {
    const next = stampUpdate({ name: 'নতুন নাম' }, { pharmacy_id: PH }, PH, NOW);
    expect(next.updated_at).toBe(NOW);
    expect(next.dirty).toBe(1);
  });

  it('সার্ভার থেকে নামানো সারি আবার পাঠানোর তালিকায় যায় না', () => {
    // এটাই মূল পরীক্ষা: এই আচরণ না থাকলে সিঙ্ক অসীম চক্রে পড়ত
    const serverTime = '2026-08-27T09:00:00.000Z';
    const next = stampUpdate(
      { dirty: 0, updated_at: serverTime, name: 'সার্ভারের নাম' },
      { pharmacy_id: PH }, PH, NOW,
    );
    expect(next.dirty).toBeUndefined();
    expect(next.updated_at).toBeUndefined();
  });

  it('পাঠানো হয়ে গেছে চিহ্ন দিলে সময় নতুন করে বসে না', () => {
    const next = stampUpdate({ dirty: 0 }, { pharmacy_id: PH }, PH, NOW);
    expect(next.dirty).toBeUndefined();
    expect(next.updated_at).toBe(NOW);
  });

  it('পুরোনো সারিতে ফার্মেসি পরিচয় না থাকলে বসিয়ে দেয়', () => {
    const next = stampUpdate({ name: 'x' }, {}, PH, NOW);
    expect(next.pharmacy_id).toBe(PH);
  });

  it('ফার্মেসি পরিচয় আগে থেকে থাকলে ছোঁয় না', () => {
    const next = stampUpdate({ name: 'x' }, { pharmacy_id: 'other' }, PH, NOW);
    expect(next.pharmacy_id).toBeUndefined();
  });
});

describe('চেকপয়েন্ট', () => {
  const cp = (id: string, at: string): { id: string; created_at: string } => ({ id, created_at: at });

  it('সাম্প্রতিক তিনটি রাখে, বাকিগুলো সরায়', () => {
    const list = [
      cp('a', '2026-08-01T00:00:00Z'), cp('b', '2026-08-02T00:00:00Z'),
      cp('c', '2026-08-03T00:00:00Z'), cp('d', '2026-08-04T00:00:00Z'),
      cp('e', '2026-08-05T00:00:00Z'),
    ];
    expect(selectCheckpointsToPrune(list).sort()).toEqual(['a', 'b']);
  });

  it('তিনটির কম থাকলে কিছুই সরায় না', () => {
    expect(selectCheckpointsToPrune([cp('a', '2026-08-01T00:00:00Z')])).toEqual([]);
  });

  it('সারির সংখ্যা মিললে ছবিটি বিশ্বাসযোগ্য', () => {
    const good: Checkpoint = {
      id: 'x', created_at: NOW, reason: 'test', from_version: 2, to_version: 3,
      table_counts: { medicines: 2, sales: 1 },
      tables: { medicines: [{}, {}], sales: [{}] },
    };
    expect(verifyCheckpoint(good).ok).toBe(true);
  });

  it('সংখ্যা না মিললে ধরা পড়ে', () => {
    const bad: Checkpoint = {
      id: 'x', created_at: NOW, reason: 'test', from_version: 2, to_version: 3,
      table_counts: { medicines: 5 },
      tables: { medicines: [{}, {}] },
    };
    const r = verifyCheckpoint(bad);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('medicines');
  });
});

describe('আবার চেষ্টার সময়', () => {
  it('ধাপে ধাপে বাড়ে', () => {
    expect(retryDelaySeconds(1)).toBe(5);
    expect(retryDelaySeconds(2)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(4)).toBe(600);
  });

  it('এক ঘণ্টার বেশি বাড়ে না', () => {
    expect(retryDelaySeconds(5)).toBe(3600);
    expect(retryDelaySeconds(50)).toBe(3600);
  });

  it('নেটওয়ার্কের সমস্যায় চেষ্টা চলতেই থাকে', () => {
    expect(shouldRetry(1, 'network')).toBe(true);
    expect(shouldRetry(100, 'network')).toBe(true);
  });

  it('সার্ভার প্রত্যাখ্যান করলে পাঁচবারে থামে', () => {
    expect(shouldRetry(4, 'rejected')).toBe(true);
    expect(shouldRetry(5, 'rejected')).toBe(false);
  });

  it('পরের চেষ্টার সময় সামনের দিকে যায়', () => {
    const from = new Date('2026-08-27T10:00:00.000Z');
    expect(nextRetryAt(1, from)).toBe('2026-08-27T10:00:05.000Z');
    expect(nextRetryAt(3, from)).toBe('2026-08-27T10:02:00.000Z');
  });
});
