/**
 * ভূমিকা সংক্রান্ত একমাত্র সত্য — নাম, ক্রম আর বাংলা লেবেল।
 *
 * আগে এই মানচিত্রটি তিন জায়গায় আলাদা করে লেখা ছিল: AppShell.tsx-এর
 * getRoleBadge(), login/page.tsx-এর ROLE_BN আর settings/page.tsx-এর ROLE_BN
 * (ঝুঁকি R18)। ষষ্ঠ ভূমিকা যোগ করতে বা একটি শব্দ বদলাতে তিনটি ফাইল ছুঁতে হতো।
 * এখন একটিই জায়গা।
 */
import type { MemberRole } from '@/types/db';

/** ভূমিকার বাংলা নাম। */
export const ROLE_BN: Record<MemberRole, string> = {
  owner: 'মালিক',
  manager: 'ম্যানেজার',
  cashier: 'ক্যাশিয়ার',
  inventory: 'স্টক কর্মী',
  accountant: 'হিসাবরক্ষক',
};

/**
 * ক্ষমতার ক্রমে সাজানো তালিকা — drop-down আর তালিকায় এই ক্রমই ব্যবহার হবে।
 * `src/types/db.ts`-এর MemberRole ইউনিয়নের সঙ্গে হাতে মিলিয়ে রাখা হয়েছে;
 * কোনোটি বাদ পড়লে নিচের টাইপ-দাবিটিই compile-এ আটকাবে।
 */
export const ROLE_ORDER = [
  'owner', 'manager', 'cashier', 'inventory', 'accountant',
] as const satisfies readonly MemberRole[];

/** ইউনিয়নের প্রতিটি সদস্য তালিকায় আছে কিনা — না থাকলে tsc এখানেই থামবে। */
type _AllRolesListed = Exclude<MemberRole, (typeof ROLE_ORDER)[number]> extends never
  ? true
  : ['ROLE_ORDER-এ একটি ভূমিকা বাদ পড়েছে', Exclude<MemberRole, (typeof ROLE_ORDER)[number]>];
const _allRolesListed: _AllRolesListed = true;
void _allRolesListed;

/**
 * drop-down-এ কোন ভূমিকাগুলো দেখানো যাবে।
 *
 * মালিক বানাতে পারেন কেবল আরেকজন মালিক — নিয়মটি ডেটাবেসে
 * `membership_update_admin`-এর `(role <> 'owner' or is_owner())`-এ লেখা আছে।
 * এখানে সেটিই আগে থেকে দেখানো হয়, যাতে ব্যবহারকারী চেষ্টা করে ত্রুটি দেখে
 * নিয়মটি আবিষ্কার না করেন। এটি সার্ভারের যাচাইয়ের বদলি নয়, তার প্রতিচ্ছবি।
 */
export function selectableRolesFor(isOwner: boolean): MemberRole[] {
  return ROLE_ORDER.filter((r) => r !== 'owner' || isOwner);
}

/**
 * অজানা মান এলে সেটিই ফেরানো হয়, ফাঁকা নয় — সার্ভার নতুন ভূমিকা পাঠালে
 * পর্দায় কিছু-না দেখানোর চেয়ে কাঁচা নামটি দেখানো ভালো।
 */
export function roleBn(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_BN[role as MemberRole] ?? role;
}
