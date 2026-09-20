import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getActivePharmacyId,
  setActivePharmacyId,
  isSupabaseConfigured,
  validateSupabaseConfig,
  getSupabaseClient,
  getSupabaseConfigError,
  resetSupabaseClient,
  SUPABASE_URL_VAR,
  SUPABASE_KEY_VAR,
} from '@/lib/supabase/client';
import {
  previewInvite, redeemInvite, signUpOwner, resolveActivePharmacyId,
} from '@/lib/supabase/auth';

/**
 * supabase-js নকল করা হয়েছে যাতে ডাকার *ক্রম* দেখা যায়। signUpOwner()-এর
 * ক্রমটিই আসল নিয়ম: আগে auth.signUp, তারপর pharmacies, তারপর memberships।
 * ক্রম উল্টে গেলে can_bootstrap_owner() ঠেকিয়ে দেয়, তাই এটিই পরীক্ষার যোগ্য।
 */
const mockState = vi.hoisted(() => ({
  calls: [] as string[],
  createClientArgs: [] as Array<{ url: string; key: string }>,
  insertErrors: {} as Record<string, { message: string } | null>,
  rpcResults: {} as Record<string, { data: unknown; error: { message: string } | null }>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string) => {
    mockState.createClientArgs.push({ url, key });
    mockState.calls.push('createClient');
    return {
      auth: {
        signUp: async () => {
          mockState.calls.push('auth.signUp');
          return { data: { user: { id: 'user-1' } }, error: null };
        },
        signInWithPassword: async () => {
          mockState.calls.push('auth.signInWithPassword');
          return { data: { user: { id: 'user-1' } }, error: null };
        },
        getUser: async () => ({ data: { user: { id: 'user-1' } } }),
        signOut: async () => ({ error: null }),
      },
      from: (table: string) => ({
        insert: async (row: Record<string, unknown>) => {
          mockState.calls.push(`insert:${table}:${JSON.stringify(row.created_by ?? row.role ?? '')}`);
          return { error: mockState.insertErrors[table] ?? null };
        },
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
      rpc: async (name: string) => {
        mockState.calls.push(`rpc:${name}`);
        return mockState.rpcResults[name] ?? { data: null, error: null };
      },
    };
  },
}));

const GOOD_URL = 'https://abcdefghijklmnop.supabase.co';
const GOOD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-anon-key-value';

function configure(url: string | undefined, key: string | undefined) {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
  resetSupabaseClient();
}
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

    mockState.calls = [];
    mockState.createClientArgs = [];
    mockState.insertErrors = {};
    mockState.rpcResults = {};
    configure(undefined, undefined);
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

    it('resolveActivePharmacyId keeps a stored choice that is still valid', () => {
      const memberships: Membership[] = [
        { user_id: 'u1', pharmacy_id: 'p1', role: 'manager', is_default: false },
        { user_id: 'u1', pharmacy_id: 'p2', role: 'cashier', is_default: true },
      ];
      expect(resolveActivePharmacyId(memberships, 'p1')).toBe('p1');
    });

    it('resolveActivePharmacyId ignores a stored pharmacy the user is not a member of', () => {
      const memberships: Membership[] = [
        { user_id: 'u1', pharmacy_id: 'p1', role: 'manager', is_default: false },
        { user_id: 'u1', pharmacy_id: 'p2', role: 'cashier', is_default: true },
      ];
      // ভুয়া দাবি মানা হয় না — is_default-এ ফিরে আসে, p-stranger-এ নয়।
      expect(resolveActivePharmacyId(memberships, 'p-stranger')).toBe('p2');
    });

    it('resolveActivePharmacyId falls back to the first membership when none is default', () => {
      const memberships: Membership[] = [
        { user_id: 'u1', pharmacy_id: 'p1', role: 'manager', is_default: false },
        { user_id: 'u1', pharmacy_id: 'p2', role: 'cashier', is_default: false },
      ];
      expect(resolveActivePharmacyId(memberships, null)).toBe('p1');
    });

    it('resolveActivePharmacyId uses the only membership even against a stale stored value', () => {
      const memberships: Membership[] = [
        { user_id: 'u1', pharmacy_id: 'p1', role: 'cashier', is_default: true },
      ];
      expect(resolveActivePharmacyId(memberships, 'p-gone')).toBe('p1');
      expect(resolveActivePharmacyId([], 'p-gone')).toBeNull();
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
  describe('signUpOwner ordering (the bootstrap-owner invariant)', () => {
    it('creates the auth user, then the pharmacy carrying created_by, then the owner membership', async () => {
      configure(GOOD_URL, GOOD_KEY);

      const { userId, pharmacyId } = await signUpOwner({
        email: 'owner@example.com',
        password: 'secret123',
        pharmacyName: 'সেবা ফার্মেসী',
      });

      expect(userId).toBe('user-1');
      expect(pharmacyId).toMatch(/^[0-9a-f-]{36}$/);

      // ক্রমটিই নিয়ম: signUp -> pharmacies(created_by=user) -> memberships(owner)
      const order = mockState.calls.filter((c) => c !== 'createClient');
      expect(order).toEqual([
        'auth.signUp',
        'insert:pharmacies:"user-1"',
        'insert:memberships:"owner"',
      ]);
    });

    it('does not insert the membership when the pharmacy insert fails', async () => {
      configure(GOOD_URL, GOOD_KEY);
      mockState.insertErrors.pharmacies = { message: 'permission denied' };

      await expect(
        signUpOwner({ email: 'o@e.com', password: 'secret123', pharmacyName: 'X' }),
      ).rejects.toThrow('ফার্মেসি তৈরি ব্যর্থ');

      // memberships-এ যেন কিছুই না যায় — created_by ছাড়া owner বসানো মানে F1।
      expect(mockState.calls.some((c) => c.startsWith('insert:memberships'))).toBe(false);
    });
  });

  describe('server errors reach the caller instead of being swallowed', () => {
    it('redeemInvite surfaces the message redeem_invite() raised', async () => {
      configure(GOOD_URL, GOOD_KEY);
      mockState.rpcResults.redeem_invite = {
        data: null,
        error: { message: 'আমন্ত্রণ কোডটি ভুল বা মেয়াদ শেষ' },
      };

      await expect(redeemInvite('INVITE-BAD')).rejects.toThrow('আমন্ত্রণ কোডটি ভুল বা মেয়াদ শেষ');
      expect(mockState.calls).toContain('rpc:redeem_invite');
    });

    it('redeemInvite surfaces the not-logged-in refusal', async () => {
      configure(GOOD_URL, GOOD_KEY);
      mockState.rpcResults.redeem_invite = {
        data: null,
        error: { message: 'লগইন ছাড়া যোগ দেওয়া যাবে না' },
      };
      await expect(redeemInvite('INVITE-A-1')).rejects.toThrow('লগইন ছাড়া যোগ দেওয়া যাবে না');
    });

    it('previewInvite surfaces the R10 throttle message', async () => {
      configure(GOOD_URL, GOOD_KEY);
      mockState.rpcResults.invite_preview = {
        data: null,
        error: { message: 'অতিরিক্ত ভুল কোড চেষ্টা করা হয়েছে — ১৫ মিনিট পর আবার চেষ্টা করুন' },
      };
      await expect(previewInvite('INVITE-A-1')).rejects.toThrow('অতিরিক্ত ভুল কোড চেষ্টা');
    });

    it('redeemInvite makes the returned pharmacy the active one', async () => {
      configure(GOOD_URL, GOOD_KEY);
      mockState.rpcResults.redeem_invite = { data: 'pharmacy-99', error: null };

      const id = await redeemInvite('INVITE-A-1');
      expect(id).toBe('pharmacy-99');
      expect(getActivePharmacyId()).toBe('pharmacy-99');
    });
  });

  describe('a misconfigured deploy fails loudly, an unconfigured one does not', () => {
    it('treats both variables missing as supported offline mode', () => {
      expect(validateSupabaseConfig(undefined, undefined)).toEqual({ status: 'absent' });
      expect(validateSupabaseConfig('', '   ')).toEqual({ status: 'absent' });
      configure(undefined, undefined);
      expect(isSupabaseConfigured()).toBe(false);
      expect(getSupabaseConfigError()).toBeNull();
    });

    it('accepts a well-formed pair, including a local supabase start URL', () => {
      expect(validateSupabaseConfig(GOOD_URL, GOOD_KEY).status).toBe('ok');
      expect(validateSupabaseConfig('http://localhost:54321', GOOD_KEY).status).toBe('ok');
    });

    it('rejects a half-set pair and names the missing variable', () => {
      const onlyUrl = validateSupabaseConfig(GOOD_URL, undefined);
      expect(onlyUrl.status).toBe('invalid');
      if (onlyUrl.status === 'invalid') {
        expect(onlyUrl.problems.join(' ')).toContain(SUPABASE_KEY_VAR);
      }

      const onlyKey = validateSupabaseConfig(undefined, GOOD_KEY);
      expect(onlyKey.status).toBe('invalid');
      if (onlyKey.status === 'invalid') {
        expect(onlyKey.problems.join(' ')).toContain(SUPABASE_URL_VAR);
      }
    });

    it('rejects a malformed URL, a placeholder key and a truncated key', () => {
      expect(validateSupabaseConfig('not-a-url', GOOD_KEY).status).toBe('invalid');
      expect(validateSupabaseConfig('ftp://x.supabase.co', GOOD_KEY).status).toBe('invalid');
      expect(validateSupabaseConfig(GOOD_URL, 'dummy-anon-key').status).toBe('invalid');
      expect(validateSupabaseConfig(GOOD_URL, 'short').status).toBe('invalid');
      expect(validateSupabaseConfig('https://a b.co', GOOD_KEY).status).toBe('invalid');
    });

    it('never builds a client against a dummy or half-set config', () => {
      configure(GOOD_URL, 'dummy-anon-key');
      expect(() => getSupabaseClient()).toThrow(SUPABASE_KEY_VAR);

      configure(GOOD_URL, undefined);
      expect(() => getSupabaseClient()).toThrow(SUPABASE_KEY_VAR);

      configure(undefined, undefined);
      expect(() => getSupabaseClient()).toThrow();

      // একবারও createClient ডাকা হয়নি — dummy মান দিয়ে সংযোগ তৈরি হয় না।
      expect(mockState.createClientArgs).toHaveLength(0);
    });

    it('builds the client with the real values once configured', () => {
      configure(GOOD_URL, GOOD_KEY);
      getSupabaseClient();
      expect(mockState.createClientArgs).toEqual([{ url: GOOD_URL, key: GOOD_KEY }]);
      expect(getSupabaseConfigError()).toBeNull();
    });
  });
});
