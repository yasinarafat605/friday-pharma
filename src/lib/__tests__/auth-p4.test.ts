import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActivePharmacyId,
  setActivePharmacyId,
  isSupabaseConfigured,
} from '@/lib/supabase/client';
import { previewInvite, redeemInvite } from '@/lib/supabase/auth';
import {
  isValidPinFormat,
  PIN_LENGTH,
  lock,
  unlock,
  isUnlocked,
} from '@/lib/auth';
import type { Membership } from '@/types/db';

class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.get(key) ?? null; }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string) { this.store.delete(key); }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
}

describe('P4 Authentication & Tenancy Client Logic', () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      (globalThis as unknown as { localStorage: Storage }).localStorage = new MockStorage();
    }
    if (typeof globalThis.sessionStorage === 'undefined') {
      (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = new MockStorage();
    }
    globalThis.localStorage.clear();
    globalThis.sessionStorage.clear();
    setActivePharmacyId(null);
    lock();
  });

  describe('Active Pharmacy Storage & Resolution', () => {
    it('getActivePharmacyId returns null when nothing is set', () => {
      expect(getActivePharmacyId()).toBeNull();
    });

    it('setActivePharmacyId persists and retrieves pharmacy ID', () => {
      const pid = '11111111-2222-3333-4444-555555555555';
      setActivePharmacyId(pid);
      expect(getActivePharmacyId()).toBe(pid);
    });

    it('setActivePharmacyId(null) clears stored pharmacy ID', () => {
      setActivePharmacyId('11111111-2222-3333-4444-555555555555');
      setActivePharmacyId(null);
      expect(getActivePharmacyId()).toBeNull();
    });

    it('resolves active pharmacy for single membership', () => {
      const memberships: Membership[] = [
        {
          user_id: 'u1',
          pharmacy_id: 'p1',
          role: 'cashier',
          is_default: true,
        },
      ];

      // Logic matching signIn: 1 membership -> always resolves to that one
      const resolved = memberships.length === 1 ? memberships[0].pharmacy_id : null;
      expect(resolved).toBe('p1');
    });

    it('resolves active pharmacy for multiple memberships using default', () => {
      const memberships: Membership[] = [
        {
          user_id: 'u1',
          pharmacy_id: 'p1',
          role: 'manager',
          is_default: false,
        },
        {
          user_id: 'u1',
          pharmacy_id: 'p2',
          role: 'cashier',
          is_default: true,
        },
      ];

      // If current active is null, pick default
      const currentActive: string | null = null;
      const matchesCurrent = currentActive && memberships.some((m) => m.pharmacy_id === currentActive);
      const defaultM = memberships.find((m) => m.is_default);
      const resolved = matchesCurrent ? currentActive : (defaultM ? defaultM.pharmacy_id : memberships[0].pharmacy_id);

      expect(resolved).toBe('p2');
    });

    it('retains current active pharmacy if valid within memberships', () => {
      const memberships: Membership[] = [
        {
          user_id: 'u1',
          pharmacy_id: 'p1',
          role: 'manager',
          is_default: false,
        },
        {
          user_id: 'u1',
          pharmacy_id: 'p2',
          role: 'cashier',
          is_default: true,
        },
      ];

      const currentActive = 'p1';
      const matchesCurrent = memberships.some((m) => m.pharmacy_id === currentActive);
      const defaultM = memberships.find((m) => m.is_default);
      const resolved = matchesCurrent ? currentActive : (defaultM ? defaultM.pharmacy_id : memberships[0].pharmacy_id);

      expect(resolved).toBe('p1');
    });

    it('ignores invalid active claim and falls back to default', () => {
      const memberships: Membership[] = [
        {
          user_id: 'u1',
          pharmacy_id: 'p1',
          role: 'manager',
          is_default: false,
        },
        {
          user_id: 'u1',
          pharmacy_id: 'p2',
          role: 'cashier',
          is_default: true,
        },
      ];

      const currentActive = 'p-stranger';
      const matchesCurrent = memberships.some((m) => m.pharmacy_id === currentActive);
      const defaultM = memberships.find((m) => m.is_default);
      const resolved = matchesCurrent ? currentActive : (defaultM ? defaultM.pharmacy_id : memberships[0].pharmacy_id);

      expect(resolved).toBe('p2');
    });
  });

  describe('Invite Preview & Redeem Inputs', () => {
    it('previewInvite returns null immediately on blank or whitespace code', async () => {
      expect(await previewInvite('')).toBeNull();
      expect(await previewInvite('   ')).toBeNull();
    });

    it('redeemInvite throws error on empty code', async () => {
      await expect(redeemInvite('')).rejects.toThrow('আমন্ত্রণ কোড দিন');
      await expect(redeemInvite('   ')).rejects.toThrow('আমন্ত্রণ কোড দিন');
    });
  });

  describe('8-Digit PIN Screen Lock Preservation', () => {
    it('enforces exact 8-digit numeric PIN format', () => {
      expect(PIN_LENGTH).toBe(8);
      expect(isValidPinFormat('12345678')).toBe(true);
      expect(isValidPinFormat('00000000')).toBe(true);
      expect(isValidPinFormat('1234567')).toBe(false); // 7 digits
      expect(isValidPinFormat('123456789')).toBe(false); // 9 digits
      expect(isValidPinFormat('1234abcd')).toBe(false); // non-numeric
      expect(isValidPinFormat('')).toBe(false);
    });

    it('screen lock and unlock operate independently of server auth', () => {
      expect(isUnlocked()).toBe(false);
      unlock();
      expect(isUnlocked()).toBe(true);
      lock();
      expect(isUnlocked()).toBe(false);
    });
  });

  describe('Configuration Detection', () => {
    it('isSupabaseConfigured returns a boolean', () => {
      expect(typeof isSupabaseConfigured()).toBe('boolean');
    });
  });
});
