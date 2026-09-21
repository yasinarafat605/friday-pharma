/**
 * অনুমতি-নির্ভর মেনু।
 *
 * এই লিংকগুলো অনুমতি না থাকলে **থাকেই না** — নিষ্ক্রিয় অবস্থায় দেখানো হয় না।
 * ক্যাশিয়ারের জানার দরকার নেই যে সদস্য-ব্যবস্থাপনার পর্দাটি আছে।
 *
 * মন দিন: এটি সুবিধা ও বাড়তি স্তর, সুরক্ষার সীমানা নয়। static export-এ
 * প্রতিটি পাতা আগেই তৈরি হয়ে থাকে, তাই ঠিকানা লিখে খোলস পাওয়া যায়।
 * আসল সীমানা RLS — সেখানে অনুমতি ছাড়া সারিও আসে না, লেখাও যায় না।
 */

export interface GatedNavItem {
  href: string;
  label: string;
  icon: string;
  permission: string;
}

export const GATED_NAV: readonly GatedNavItem[] = [
  {
    href: '/members',
    label: 'সদস্য ও আমন্ত্রণ',
    icon: '🧑‍🤝‍🧑',
    permission: 'members.manage',
  },
];

/**
 * যে লিংকগুলোর অনুমতি আছে কেবল সেগুলোই ফেরে।
 * তালিকা ফাঁকা বা অজানা হলে কিছুই ফেরে না — সন্দেহে আড়াল (fail closed)।
 */
export function filterGatedNav(
  items: readonly GatedNavItem[],
  permissions: readonly string[] | null | undefined,
): GatedNavItem[] {
  if (!permissions || permissions.length === 0) return [];
  return items.filter((item) => permissions.includes(item.permission));
}
