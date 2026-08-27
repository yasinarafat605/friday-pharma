# আশ শিফা ফার্মেসী — প্রকল্প পরিকল্পনা ও ডিজাইন

> সহজ হিসাব, নিরাপদ ব্যবস্থাপনা

এই ডকুমেন্টটি কোড লেখার আগের চূড়ান্ত পরিকল্পনা। এখানে ৯টি অংশ আছে: প্রকল্প বোঝাপড়া, ফিচার তালিকা, বাদ দেওয়া ফিচার, architecture, database schema, security plan, development phases, folder structure — এবং তারপর implementation।

> **হালনাগাদ (চূড়ান্ত বাস্তবায়ন):** Supabase/cloud বাদ দেওয়া হয়েছে। অ্যাপটি এখন **সম্পূর্ণ local, single-device** — সব ডেটা ব্রাউজারের IndexedDB (Dexie)-তে, লগইন **৮ সংখ্যার PIN** দিয়ে (রিসেট: ফোন নম্বরের শেষ ৪ সংখ্যা)। নিচের section ৪–৬-এ Supabase/RLS-এর উল্লেখ ঐতিহাসিক পরিকল্পনা; বাস্তবে সব নিয়ম client-side transaction ও Web Crypto দিয়ে enforce হয়। বর্তমান নির্ভরযোগ্য তথ্যের জন্য `README.md` দেখুন।

---

## ১. সংক্ষিপ্ত প্রকল্প বোঝাপড়া (Project Understanding)

আশ শিফা ফার্মেসী হলো বাংলাদেশের একটি ছোট গ্রামের ফার্মেসির জন্য একক-ব্যবহারকারী (শুধু মালিক) ব্যবস্থাপনা অ্যাপ। মূল উদ্দেশ্য:

- ওষুধের **স্টক** সঠিক রাখা (batch-ভিত্তিক, expiry সহ)
- **দৈনিক বিক্রয়** — নগদ, বাকি, মিশ্র
- **পাওনাদার (বাকি) হিসাব** ও **বাকি আদায়** রেকর্ড
- **দোকানের খরচ** হিসাব
- **প্রকৃত লাভ/ক্ষতি** ও **ক্যাশবক্স** হিসাব
- **মেয়াদোত্তীর্ণ** ও **কম স্টক** সতর্কতা
- সব তথ্য **নিরাপদ** রাখা এবং **ব্যাকআপ/সিঙ্ক**

**সিদ্ধান্ত (আপনার সাথে নিশ্চিত করা):**
- **একাধিক ডিভাইস + Cloud sync** — মালিক ফোন ও কম্পিউটার দুটোতেই একই ডেটা দেখবেন।
- অ্যাপটি **offline-first**: ইন্টারনেট না থাকলেও বিক্রয়/স্টক/আদায়/খরচ চলবে, ইন্টারনেট এলে নিরাপদে sync হবে।

মূল অগ্রাধিকার: **সরলতা, বাংলা ভাষা, বড় বাটন, কম click, offline নির্ভরযোগ্যতা, data-loss প্রতিরোধ, security ও হিসাবের নির্ভুলতা।**

---

## ২. চূড়ান্ত ফিচার তালিকা (Final Feature List)

**প্রমাণীকরণ ও নিরাপত্তা**
- মালিকের secure login (email + password, hashed)
- Password পরিবর্তন, PIN lock, auto screen lock (inactivity), logout/session invalidate
- Failed login limit + temporary lock
- Audit log সব গুরুত্বপূর্ণ পরিবর্তনে

**ড্যাশবোর্ড** — আজকের বিক্রয় (মোট/নগদ/বাকি), আজকের আদায়, খরচ, আনুমানিক লাভ, মোট পাওনা, স্টকের মূল্য, কম স্টক, মেয়াদ সতর্কতা, ক্যাশবক্স।

**ওষুধ ও ইনভেন্টরি** — ওষুধ CRUD, batch-ভিত্তিক স্টক, ধরন (সিরাপ/ট্যাবলেট/ক্যাপসুল/…), unit, নোট, সক্রিয়/বন্ধ। কম স্টক নিয়ম: সিরাপ ≤১ বোতল, ট্যাবলেট ≤১০ পিস, ক্যাপসুল ≤১০ পিস → alert (কমলা/লাল/সবুজ)।

**Expiry** — batch-প্রতি expiry, সতর্কতা ৯০/৬০/৩০ দিন ও expired; expired বিক্রি নিষিদ্ধ; বিক্রয়ে কাছাকাছি-expiry batch আগে (FEFO)।

**নতুন স্টক** — ওষুধ নির্বাচন/নতুন তৈরি, batch, expiry, quantity, ক্রয়/বিক্রয়মূল্য, entry তারিখ, optional invoice no ও নোট। (Supplier নেই।)

**বিক্রয়** — দ্রুত সার্চ (নাম/generic/কোম্পানি), পরিমাণ, discount, payment type (নগদ/বাকি/মিশ্র), পাওনাদার নির্বাচন। বিক্রয়ের পর: স্টক কমবে, ক্যাশ/বাকি update, sale history, profit update। **কোনো bill/print নেই** — শুধু screen summary।

**পাওনাদার** — profile (নাম/ফোন/গ্রাম/ছবি/নোট), সম্পূর্ণ ledger, বর্তমান বাকি, মোট ক্রয়/পরিশোধ, auto update। "পরিশোধ সম্পন্ন" স্ট্যাটাস।

**বাকি আদায়** — manual payment entry (তারিখ, পরিমাণ, method, নোট); overpayment validation error।

**খরচ** — ক্যাটাগরি সহ সহজ entry, optional receipt photo, payment source; ভাড়া/বিদ্যুৎ monthly reminder।

**ক্যাশ হিসাব** — opening + নগদ বিক্রয় + আদায় − খরচ − ক্রয় = expected closing; actual cash ও difference।

**বিক্রয় রিটার্ন** — original sale থেকে return, reason, refund, restock (expired/damaged/opened restock হবে না); due/cash অনুযায়ী update।

**স্টক adjustment** — কারণ বাধ্যতামূলক (মেয়াদ/নষ্ট/ভাঙা/হারানো/…); audit history।

**রিপোর্ট** — দৈনিক, মাসিক, inventory; CSV export (invoice নয়)।

**সার্চ ও ফিল্টার** — ওষুধ/generic/কোম্পানি/batch/পাওনাদার; low/out/expiring/expired/ধরন/বাকি filter।

**ব্যাকআপ ও সিঙ্ক** — offline local DB, cloud sync (conflict-safe, unique txn id), encrypted backup export (USB/folder), restore preview + safety backup।

**সেটিংস** — ফার্মেসি/মালিক তথ্য, ভাষা, PIN, auto-lock, backup, alert নিয়ম, password change, export/restore।

---

## ৩. বাদ দেওয়া ফিচার (Excluded — তৈরি হবে না)

Supplier management/profile/due · Employee/staff login · Multiple branch/transfer · Payroll/attendance · Online payment gateway ও auto payment · বিকাশ/নগদ/রকেট/ব্যাংক/কার্ড API · Ecommerce/online ordering/home delivery · Bill/thermal/PDF invoice/receipt printing · জটিল accounting · অপ্রয়োজনীয় AI · বিজ্ঞাপন/marketing analytics/customer tracking · Third-party data sharing।

> মোবাইল ব্যাংকিং টাকা **manual entry** হিসেবে রেকর্ড হবে — কোনো API নয়।

---

## ৪. প্রস্তাবিত Architecture

**Local-first PWA + Supabase cloud sync.**

| স্তর | প্রযুক্তি |
|---|---|
| Frontend | Next.js 14 (App Router) + React + TypeScript |
| UI | Tailwind CSS, বড় বাংলা টাইপোগ্রাফি (Noto Sans Bengali / Hind Siliguri) |
| Local DB (offline) | IndexedDB via **Dexie** — UI-এর source of truth |
| Sync engine | Outbox queue → Supabase; unique client txn id; conflict detection |
| Cloud DB | Supabase **PostgreSQL** (RLS + constraints + triggers + RPC) |
| Auth | Supabase Auth (owner email+password) + client PIN/auto-lock |
| Validation | **Zod** (client) + Postgres constraints/RPC (server) |
| Money | সব টাকা **integer paisa** — floating-point error এড়াতে |
| PWA | manifest + service worker, installable, offline shell |

**Offline-first প্রবাহ:** সব লেখা প্রথমে local Dexie-তে commit → outbox-এ যায় → online হলে Supabase RPC-তে idempotent push (client_txn_id দিয়ে duplicate রোধ) → server truth নামিয়ে reconcile। UI সবসময় local থেকে তাৎক্ষণিক render করে, তাই ইন্টারনেট ছাড়াও দ্রুত।

**নির্ভুলতার নিয়ম:** গুরুত্বপূর্ণ আর্থিক গণনা ও business rule server RPC/constraint-এ চূড়ান্তভাবে যাচাই হয়; frontend value সরাসরি বিশ্বাস করা হয় না।

---

## ৫. Database Schema Overview

সব টাকা `*_paisa BIGINT` (integer)। সব টেবিলে `id UUID`, `created_at`, `updated_at`, `client_txn_id` (idempotency), soft-cancel (`status`) যেখানে প্রযোজ্য।

- **owners** — মালিক প্রোফাইল ও auth লিংক।
- **app_settings** — ফার্মেসি তথ্য, ভাষা, alert নিয়ম, PIN hash, backup config।
- **medicines** — নাম, বাংলা নাম, generic, কোম্পানি, ধরন (enum), unit (enum), low-stock threshold, নোট, is_active।
- **medicine_batches** — medicine_id, batch_no, expiry_date, purchase_price_paisa, sale_price_paisa, qty_in_stock; (medicine_id, batch_no) unique।
- **stock_entries** — batch-এ নতুন স্টক যোগ (qty, দাম, entry date, invoice_no, note)।
- **sales** — txn_no (unique), তারিখ, subtotal/discount/total_paisa, payment_type (enum), cash_paid_paisa, due_paisa, customer_id?, status (completed/cancelled), note।
- **sale_items** — sale_id, medicine_id, batch_id, qty, unit_price_paisa, line_total_paisa, cost_price_paisa (profit-এর জন্য)।
- **customers** — নাম, ফোন, গ্রাম, photo_url, নোট, প্রথম/শেষ লেনদেন তারিখ, current_due_paisa (derived cache)।
- **customer_ledger** — প্রতিটি entry (sale_due / payment / return_adjust), amount_paisa (+/−), running ধারা।
- **due_payments** — receipt_ref (unique), customer_id, তারিখ, amount_paisa, method (enum), note; overpay নিষিদ্ধ।
- **expense_categories** — seed করা ক্যাটাগরি।
- **expenses** — তারিখ, category_id, amount_paisa (>0), বিবরণ, receipt_url, payment_source।
- **cash_sessions** — দিন-প্রতি opening/closing, expected vs actual, difference।
- **stock_adjustments** — batch_id, qty, reason (enum, বাধ্যতামূলক), note, audit।
- **sale_returns** + **sale_return_items** — original sale, qty, reason, refund, restock flag।
- **audit_logs** — entity, action, old_value(jsonb), new_value(jsonb), timestamp, device।
- **backups** — backup meta (type, size, checksum, encrypted flag, তারিখ)।
- **sync_outbox** (local only) — অপেক্ষমাণ mutations।

**ব্যবসায়িক নিয়ম DB-তে enforce:** negative stock/expense/total রোধে CHECK; stock ≥ sold quantity (trigger); expired batch বিক্রি রোধ (trigger); due ≤ current due (trigger/RPC); unique txn_no ও client_txn_id; financial row permanent delete নিষিদ্ধ (শুধু cancel/void)।

---

## ৬. Security Plan

**Auth:** Supabase Auth, password bcrypt/scrypt-hashed (কখনো plain নয়); failed-attempt limit + temporary lock; client PIN lock (hashed local); inactivity auto-lock; logout → session invalidate।

**Database:** Postgres **Row Level Security** — শুধু owner তার data দেখবে; সব query parameterized (Supabase client/RPC); SQL injection রোধ; schema validation; duplicate txn রোধ (unique client_txn_id)। Sensitive backup encrypted।

**Application:** সব form Zod validation (client) + RPC/constraint (server); React auto-escaping → XSS রোধ; Supabase token সহ CSRF-নিরাপদ প্যাটার্ন; কোনো secret frontend-এ নয় — **environment variable** (`.env`), শুধু anon key public; production error message-এ sensitive তথ্য নেই।

**আর্থিক রেকর্ড:** sale/payment/expense/adjustment **কখনো permanent delete নয়** — cancel/reverse/void; সব পরিবর্তনে audit log (কী, আগের/নতুন value, সময়, device)।

**Backup:** automatic (দৈনিক/সাপ্তাহিক) + manual; encrypted file; restore-এর আগে PIN/password যাচাই + corruption check + preview + বর্তমান DB-র safety backup; cloud backup optional ও default বন্ধ।

**Privacy:** পাওনাদার তথ্য private; কোনো third-party analytics/ad SDK/tracking নেই; debug log-এ ব্যক্তিগত/আর্থিক তথ্য নয়।

---

## ৭. Development Phases

1. **Requirement analysis** — (এই ডকুমেন্টে সম্পন্ন)।
2. **System design** — architecture, schema, security, offline/backup strategy (এই ডকুমেন্ট)।
3. **UI prototype** — Login, Dashboard, Sales, Inventory, Add stock, Customer, Due collection, Expense, Reports।
4. **Core development** (অগ্রাধিকার): auth → medicine/batch → stock entry → sales → customer ledger → due collection → expenses → cash → reports → backup/restore → audit log।
5. **Testing** — unit, form validation, stock/due/profit calc, expiry, low-stock, duplicate submit, backup/restore, auth security, offline mode।

**এই session-এ:** Phase 1–2 সম্পূর্ণ + Phase 3–4-এর foundation ও প্রধান working পেজ (login, dashboard, sales, inventory, add stock, customer, due collection, expense) + schema/migrations + core lib + docs। বাকি পেজ ও পূর্ণ test পরবর্তী ধাপে।

---

## ৮. Folder Structure

```
As Sifha Permacy/
├─ docs/                     # পরিকল্পনা ও গাইড
│  ├─ 00-PROJECT-PLAN.md
│  ├─ INSTALL.md  DEVELOPMENT.md  PRODUCTION.md
│  ├─ BACKUP-RESTORE.md  SECURITY-CHECKLIST.md  TESTING.md
├─ supabase/
│  └─ migrations/            # SQL schema, constraints, RLS, triggers, seed
├─ public/                   # manifest, icons, service worker
├─ src/
│  ├─ app/                   # Next.js App Router পেজ
│  │  ├─ (auth)/login/
│  │  └─ (app)/dashboard, sales, inventory, add-stock,
│  │           customers, due-collection, expenses, cash,
│  │           reports, backup, settings/
│  ├─ components/            # reusable UI (বড় বাটন, alert, card…)
│  ├─ lib/
│  │  ├─ supabase/           # client, server
│  │  ├─ db/                 # Dexie local DB + sync outbox
│  │  ├─ validation/         # Zod schemas
│  │  ├─ money.ts            # paisa utils
│  │  ├─ business-rules.ts   # low-stock, expiry, due নিয়ম
│  │  └─ i18n/               # বাংলা লেবেল
│  └─ types/
├─ .env.example
├─ package.json  tsconfig.json  tailwind.config.ts  next.config.mjs
└─ README.md
```

---

## ৯. Implementation

এই ডকুমেন্ট অনুমোদনের ধারাবাহিকতায় implementation শুরু — scaffold, schema/migrations, core lib, ও প্রধান working পেজ তৈরি হচ্ছে। বিস্তারিত setup ও চালানোর নিয়ম `README.md` এবং `docs/` ফোল্ডারে।
