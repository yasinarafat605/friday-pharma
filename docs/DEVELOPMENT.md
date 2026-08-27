# লোকাল ডেভেলপমেন্ট গাইড

```bash
npm run dev         # dev server (hot reload)
npm run typecheck   # TypeScript যাচাই
npm run test        # unit test (vitest)
```

## কাঠামো
- **পেজ**: `src/app/(app)/<name>/page.tsx` — client components, `src/lib/data.ts` দিয়ে ডেটা।
- **ডেটা স্তর**: `src/lib/data.ts` — সব read/write ও ব্যবসায়িক নিয়ম Dexie transaction-এ।
- **DB**: `src/lib/db/local.ts` — Dexie (IndexedDB) schema, seed, backup export/import।
- **Auth**: `src/lib/auth.ts` — PIN hash/verify/reset, session lock।
- **নিয়ম**: `src/lib/business-rules.ts` — low-stock / expiry / FEFO / due।
- **টাকা**: `src/lib/money.ts` — সবসময় integer paisa।
- **লেবেল**: `src/lib/i18n/labels.ts` — বাংলা।

## নতুন পেজ যোগ
1. `src/app/(app)/<name>/page.tsx` তৈরি করুন।
2. `src/components/AppShell.tsx`-এর `NAV` array-তে লিংক যোগ করুন।

## নতুন mutation যোগ
1. `src/lib/data.ts`-এ একটি async function লিখুন — `db().transaction('rw', [...], async () => {...})` ব্যবহার করে নিয়ম enforce করুন ও audit করুন।
2. নতুন টেবিল লাগলে `src/lib/db/local.ts`-এ Dexie version bump + store যোগ করুন, এবং `ALL_TABLES` (backup) হালনাগাদ করুন।

## কনভেনশন
- Strict TypeScript, reusable components, স্পষ্ট নাম।
- আর্থিক গণনা সবসময় paisa (integer)।
- Duplicate/negative/expired ইত্যাদি নিয়ম data.ts-এ কেন্দ্রীয়ভাবে যাচাই — frontend value অন্ধভাবে বিশ্বাস নয়।
