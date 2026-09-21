import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateInviteCode, formatForDisplay,
  INVITE_ALPHABET, INVITE_CODE_LENGTH, INVITE_ENTROPY_BITS,
} from '@/lib/supabase/invite-code';
import { ROLE_BN, ROLE_ORDER, roleBn, selectableRolesFor } from '@/lib/roles';
import { GATED_NAV, filterGatedNav } from '@/lib/nav-gate';
import { createInvite, updateMemberRole, removeMember, revokeInvite, listShopMembers } from '@/lib/supabase/members';
import { resetSupabaseClient } from '@/lib/supabase/client';
import type { MemberRole } from '@/types/db';

/**
 * supabase-js নকল — কোন টেবিলে কী সারি গেল তা ধরে রাখে, যাতে ভূমিকা
 * অপরিবর্তিত পৌঁছেছে কিনা দেখা যায়, আর সার্ভারের বাংলা ত্রুটি উপরে ওঠে কিনা।
 */
const mock = vi.hoisted(() => ({
  inserted: [] as Array<{ table: string; row: Record<string, unknown> }>,
  updated: [] as Array<{ table: string; row: Record<string, unknown> }>,
  deleted: [] as string[],
  errors: {} as Record<string, { message: string } | null>,
  selectRows: [] as unknown[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const fail = mock.errors[table] ?? null;
      const single = async () => ({
        data: mock.inserted[mock.inserted.length - 1]?.row ?? null,
        error: fail,
      });
      return {
        insert: (row: Record<string, unknown>) => {
          mock.inserted.push({ table, row });
          return {
            select: () => ({ single }),
            then: (res: (v: { error: unknown }) => unknown) => res({ error: fail }),
          };
        },
        update: (row: Record<string, unknown>) => {
          mock.updated.push({ table, row });
          const chain = {
            eq: () => chain,
            then: (res: (v: { error: unknown }) => unknown) => res({ error: fail }),
          };
          return chain;
        },
        delete: () => {
          mock.deleted.push(table);
          const chain = {
            eq: () => chain,
            is: () => chain,
            then: (res: (v: { error: unknown }) => unknown) => res({ error: fail }),
          };
          return chain;
        },
        select: () => {
          const chain = {
            eq: () => chain,
            is: () => chain,
            gt: () => chain,
            order: async () => ({ data: mock.selectRows, error: fail }),
            then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
              res({ data: mock.selectRows, error: fail }),
          };
          return chain;
        },
      };
    },
  }),
}));

function configureOk() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.members-test-key';
  resetSupabaseClient();
}

beforeEach(() => {
  mock.inserted = [];
  mock.updated = [];
  mock.deleted = [];
  mock.errors = {};
  mock.selectRows = [];
  configureOk();
});

describe('invite code generator (F5 and R10 both rest on this)', () => {
  it('uses crypto.getRandomValues and refuses to fall back to anything weaker', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const code = generateInviteCode();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    spy.mockRestore();
  });

  it('throws rather than producing a code when no secure source exists', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(() => generateInviteCode()).toThrow('crypto.getRandomValues');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when getRandomValues is missing rather than falling back', () => {
    vi.stubGlobal('crypto', {} as Crypto);
    try {
      expect(() => generateInviteCode()).toThrow('crypto.getRandomValues');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('produces the stated length and stays inside the stated alphabet', () => {
    expect(INVITE_CODE_LENGTH).toBe(16);
    expect(INVITE_ALPHABET).toHaveLength(32);
    expect(INVITE_ENTROPY_BITS).toBe(80);

    for (let i = 0; i < 500; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of code) {
        expect(INVITE_ALPHABET).toContain(ch);
      }
    }
  });

  it('drops the look-alike characters I, L, O and U', () => {
    for (const ch of ['I', 'L', 'O', 'U']) {
      expect(INVITE_ALPHABET).not.toContain(ch);
    }
    // বাদ দেওয়ার পরেও ২-এর ঘাত থাকা দরকার, নইলে বাছাইয়ে পক্ষপাত আসে
    expect(Math.log2(INVITE_ALPHABET.length) % 1).toBe(0);
    expect(new Set(INVITE_ALPHABET).size).toBe(INVITE_ALPHABET.length);
  });

  it('keeps at least 2^64 of entropy', () => {
    const bits = INVITE_CODE_LENGTH * Math.log2(INVITE_ALPHABET.length);
    expect(bits).toBeGreaterThanOrEqual(64);
    expect(() => generateInviteCode(12)).toThrow('১৩');
  });

  it('never collides across a large sample', () => {
    const seen = new Set<string>();
    const N = 20000;
    for (let i = 0; i < N; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(N);
  });

  it('groups for display without changing the stored value', () => {
    const code = generateInviteCode();
    const groups = formatForDisplay(code);
    expect(groups).toHaveLength(4);
    expect(groups.join('')).toBe(code);
    expect(groups.join(' ')).not.toBe(code);
  });
});

describe('the role travels with the code, not with the joiner', () => {
  it('writes the owner-chosen role into the invites row unchanged', async () => {
    for (const role of ROLE_ORDER) {
      mock.inserted = [];
      await createInvite({ pharmacyId: 'ph-1', role: role as MemberRole, validDays: 7 });
      expect(mock.inserted).toHaveLength(1);
      expect(mock.inserted[0].table).toBe('invites');
      expect(mock.inserted[0].row.role).toBe(role);
      expect(mock.inserted[0].row.pharmacy_id).toBe('ph-1');
    }
  });

  it('writes a code of the generated shape and never the pharmacy id', async () => {
    await createInvite({ pharmacyId: 'ph-secret-id', role: 'cashier' });
    const code = mock.inserted[0].row.code as string;
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(new RegExp(`^[${INVITE_ALPHABET}]+$`));
    expect(code).not.toContain('ph-secret-id');
    expect(code.toLowerCase()).not.toContain('secret');
  });

  it('omits expires_at so the schema default of seven days applies', async () => {
    await createInvite({ pharmacyId: 'ph-1', role: 'manager' });
    expect('expires_at' in mock.inserted[0].row).toBe(false);
  });

  it('sets expires_at when the owner picks a different window', async () => {
    await createInvite({ pharmacyId: 'ph-1', role: 'manager', validDays: 30 });
    const iso = mock.inserted[0].row.expires_at as string;
    const days = (new Date(iso).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('never inserts into memberships', async () => {
    await createInvite({ pharmacyId: 'ph-1', role: 'owner' });
    expect(mock.inserted.map((i) => i.table)).not.toContain('memberships');
  });
});

describe('promoting to owner is offered only to an owner', () => {
  it('excludes owner from the list when the actor is not an owner', () => {
    const forManager = selectableRolesFor(false);
    expect(forManager).not.toContain('owner');
    expect(forManager).toContain('manager');
    expect(forManager).toContain('cashier');
    expect(forManager).toHaveLength(ROLE_ORDER.length - 1);
  });

  it('includes owner when the actor is an owner', () => {
    const forOwner = selectableRolesFor(true);
    expect(forOwner).toContain('owner');
    expect(forOwner).toHaveLength(ROLE_ORDER.length);
  });
});

describe('a non-owner cannot reach the member screen', () => {
  it('hides the members link when members.manage is absent', () => {
    const cashier = ['records.read', 'sales.create', 'due.collect', 'customers.write'];
    expect(filterGatedNav(GATED_NAV, cashier)).toEqual([]);

    const manager = ['records.read', 'reports.read', 'settings.write', 'stock.write'];
    expect(filterGatedNav(GATED_NAV, manager)).toEqual([]);
  });

  it('shows it only when members.manage is present', () => {
    const owner = ['records.read', 'settings.write', 'members.manage', 'billing.manage'];
    const shown = filterGatedNav(GATED_NAV, owner);
    expect(shown).toHaveLength(1);
    expect(shown[0].href).toBe('/members');
  });

  it('shows nothing when the permission list is empty or unknown (fail closed)', () => {
    expect(filterGatedNav(GATED_NAV, [])).toEqual([]);
    expect(filterGatedNav(GATED_NAV, null)).toEqual([]);
    expect(filterGatedNav(GATED_NAV, undefined)).toEqual([]);
  });

  it('gates the members entry on members.manage specifically', () => {
    const entry = GATED_NAV.find((i) => i.href === '/members');
    expect(entry?.permission).toBe('members.manage');
  });
});

describe("the server's Bangla error reaches the caller", () => {
  it('surfaces R7 when the last owner would be demoted', async () => {
    mock.errors.memberships = { message: 'দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না' };
    await expect(updateMemberRole('u-1', 'ph-1', 'cashier'))
      .rejects.toThrow('দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না');
  });

  it('surfaces R7 when the last owner would be removed', async () => {
    mock.errors.memberships = { message: 'দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না' };
    await expect(removeMember('u-1', 'ph-1'))
      .rejects.toThrow('দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না');
  });

  it('surfaces an RLS refusal on role change rather than a generic message', async () => {
    mock.errors.memberships = {
      message: 'new row violates row-level security policy for table "memberships"',
    };
    await expect(updateMemberRole('u-1', 'ph-1', 'owner'))
      .rejects.toThrow('violates row-level security policy');
  });

  it('surfaces a refusal when creating an invite is denied', async () => {
    mock.errors.invites = {
      message: 'new row violates row-level security policy for table "invites"',
    };
    await expect(createInvite({ pharmacyId: 'ph-other', role: 'cashier' }))
      .rejects.toThrow('violates row-level security policy');
  });

  it('surfaces a refusal on revoke and on reading the member list', async () => {
    mock.errors.invites = { message: 'permission denied for table invites' };
    await expect(revokeInvite('ABCD1234ABCD1234')).rejects.toThrow('permission denied for table invites');

    mock.errors.memberships = { message: 'permission denied for table memberships' };
    await expect(listShopMembers('ph-1')).rejects.toThrow('permission denied for table memberships');
  });
});

describe('the shared role map is the only one (R18)', () => {
  it('labels every role in Bangla', () => {
    for (const role of ROLE_ORDER) {
      expect(ROLE_BN[role as MemberRole]).toBeTruthy();
      expect(roleBn(role)).toBe(ROLE_BN[role as MemberRole]);
    }
    expect(roleBn('owner')).toBe('মালিক');
    expect(roleBn('accountant')).toBe('হিসাবরক্ষক');
  });

  it('returns the raw value for an unknown role rather than nothing', () => {
    expect(roleBn('something-new')).toBe('something-new');
    expect(roleBn(null)).toBe('');
    expect(roleBn(undefined)).toBe('');
  });

  it('lists all five roles, owner first', () => {
    expect(ROLE_ORDER).toEqual(['owner', 'manager', 'cashier', 'inventory', 'accountant']);
    expect(Object.keys(ROLE_BN).sort()).toEqual([...ROLE_ORDER].sort());
  });
});
