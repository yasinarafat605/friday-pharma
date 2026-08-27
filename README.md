# আশ শিফা ফার্মেসী

> সহজ হিসাব, নিরাপদ ব্যবস্থাপনা — বাংলাদেশের ছোট গ্রামের ফার্মেসির জন্য একক-মালিক ব্যবস্থাপনা অ্যাপ।

সম্পূর্ণ **local, offline** PWA। কোনো ইন্টারনেট, সার্ভার বা অ্যাকাউন্ট লাগে না — সব ডেটা এই ডিভাইসেই (ব্রাউজারের IndexedDB) নিরাপদে থাকে। লগইন হয় **৮ সংখ্যার PIN** দিয়ে।

---

## ✨ প্রধান ফিচার

- **PIN লগইন** — ৮ সংখ্যার PIN (hashed), auto screen-lock, ভুল হলে temporary lock
- **ড্যাশবোর্ড** — আজকের বিক্রয়/নগদ/বাকি, আদায়, খরচ, আনুমানিক লাভ, মোট পাওনা, স্টক মূল্য, কম স্টক ও মেয়াদ সতর্কতা
- **বিক্রয়** — দ্রুত সার্চ, নগদ, বাকি বা মিশ্র, প্রতি আইটেমে দাম বদলানো যায় (পয়সা সহ), ছাড়, স্টক auto কমে, FEFO, expired বিক্রি নিষিদ্ধ (কোনো bill বা print নেই)
- **বিক্রয় তালিকা** — সব বিক্রয়ের ইতিহাস; ভুল বিক্রয় বাতিল করলে স্টক ফেরত যায় ও বাকির হিসাব ঠিক হয়
- **নতুন স্টক** — batch ও expiry ভিত্তিক, নতুন ওষুধ তৈরি
- **পাতা স্ক্যান** (শুধু Android অ্যাপে) — ওষুধের পাতার ছবি তুললে নাম, পাওয়ার ও জেনেরিক নিজে থেকে বসে; আগে থেকে থাকা ওষুধের সাথে মিলিয়েও দেখায়। দাম সবসময় হাতে দিতে হয়
- **ওষুধ ও স্টক** — সার্চ ও ফিল্টার, কম স্টক (কমলা, লাল, সবুজ), মেয়াদ অবস্থা
- **ওষুধ ব্যবস্থাপনা** — নাম, generic, কোম্পানি, ধরন, একক, কম স্টকের সীমা সংশোধন; ওষুধ বন্ধ বা চালু; batch-এর ভুল দাম, batch নম্বর ও মেয়াদ ঠিক করা — সবই audit log সহ, কিছুই মুছে যায় না
- **পাওনাদার ও বাকি আদায়** — profile, সম্পূর্ণ খতিয়ান, **পূর্বের বকেয়া** (অ্যাপ শুরুর আগের পুরোনো বাকি) যোগ ও সংশোধন, overpayment রোধ, আদায় বাতিল
- **খরচ** — ক্যাটাগরি সহ; খরচ সংশোধন ও বাতিল, সেটিংস থেকে ক্যাটাগরি যোগ, সংশোধন ও মুছে ফেলা
- **ক্যাশ হিসাব** — opening/actual, expected closing, difference
- **রিপোর্ট** — দৈনিক/মাসিক/ইনভেন্টরি + CSV export
- **বিক্রয় রিটার্ন** — restock flag, refund, due auto-adjust, রিটার্ন বাতিলের সুবিধা
- **স্টক সমন্বয়** — নষ্ট, হারানো, মেয়াদ বা ভুল এন্ট্রি; কারণ বাধ্যতামূলক, audit, সমন্বয় বাতিল করলে স্টক আগের অবস্থায় ফেরে
- **ব্যাকআপ ও Restore** — Web Crypto (AES-GCM) এনক্রিপ্টেড, restore preview ও safety backup
- **ব্যাকআপ সতর্কতা** — শেষ ব্যাকআপের তারিখ মনে রাখে; নির্ধারিত দিনের বেশি হলে ড্যাশবোর্ড ও প্রতিটি পেজে মনে করিয়ে দেয় (সেটিংসে দিন সংখ্যা বদলানো যায়)
- **সেটিংস** — ফার্মেসি তথ্য, alert নিয়ম, auto-lock, PIN পরিবর্তন

---

## 🔑 PIN ও রিসেট

- প্রথমবার অ্যাপ খুললে একটি **৮ সংখ্যার PIN** সেট করতে হবে।
- PIN ভুলে গেলে লগইন স্ক্রিনে **"PIN ভুলে গেছেন?"** → সেটিংসে থাকা **ফোন নম্বরের শেষ ৪ সংখ্যা** দিয়ে নতুন PIN সেট করা যায়।
- ডিফল্ট রিসেট ফোন: `+880 1890-163791` → শেষ ৪ সংখ্যা **3791**। সেটিংসে ফোন বদলালে রিসেট কোডও বদলাবে।

---

## 🧱 প্রযুক্তি

Next.js 14 (App Router) · TypeScript · Tailwind CSS · **Dexie / IndexedDB** (সব ডেটা local) · Web Crypto (PIN hash + এনক্রিপ্টেড backup)। সব টাকা **integer paisa** (floating-point error এড়াতে)।

---

## 🚀 চালানো

```bash
npm install
npm run dev      # http://localhost:3000
```

প্রথমবার → ৮ সংখ্যার PIN সেট করুন → অ্যাপ প্রস্তুত। ডিফল্ট খরচ ক্যাটাগরি ও সেটিংস স্বয়ংক্রিয়ভাবে তৈরি হয়।

Production:
```bash
npm run build && npm run start
```

> কোনো `.env`, database বা Supabase লাগে না।

---

## 📱 অ্যান্ড্রয়েড অ্যাপ (APK)

> **পাতা স্ক্যান চাইলে Capacitor দিয়ে বিল্ড করতে হবে** (নিচের দ্বিতীয় পদ্ধতি)। PWABuilder-এর APK-তে স্ক্যান কাজ করবে না, কারণ ML Kit একটি নেটিভ SDK। সেটআপ: **[docs/ANDROID.md](docs/ANDROID.md)**।

**সবচেয়ে সহজ (Android Studio ছাড়াই):** `npm run build` → `out/` ফোল্ডার **https://app.netlify.com/drop**-এ drag-drop → পাওয়া লিংক **https://www.pwabuilder.com**-এ দিয়ে সাইন করা APK ডাউনলোড → ফোনে ইনস্টল। পূর্ণ গাইড: **[docs/PWABUILDER.md](docs/PWABUILDER.md)**।

**অথবা** Capacitor দিয়ে লোকাল বিল্ড (Android Studio):

```bash
npm install
npm run build           # static bundle (out/)
npm run android:init    # প্রথমবার — Android প্রজেক্ট
npm run android:icons   # আইকন/স্প্ল্যাশ
npm run android:sync    # build + copy
npm run android:open    # Android Studio → Run/Build APK
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk` — ফোনে কপি করে ইনস্টল করুন।
বিস্তারিত (JDK/Android Studio, signed release, PWA উপায়): **[docs/ANDROID.md](docs/ANDROID.md)**।

App ID `com.asshifa.pharmacy`; আইকন সোর্স `resources/icon.png`।

---

## 📁 ফোল্ডার কাঠামো

```
docs/            পরিকল্পনা ও গাইড
public/          manifest, service worker (PWA)
src/app/         পেজ: (auth)/login, (app)/dashboard, sales-history, medicines … settings
src/components/  AppShell, StatCard
src/lib/
  auth.ts        PIN hash/verify/reset, session lock
  db/local.ts    Dexie DB (সব entity) + seed + export/import
  data.ts        সব ব্যবসায়িক নিয়ম ও হিসাব (transaction)
  money.ts       paisa utils
  business-rules.ts  low-stock, expiry, FEFO, due ও ব্যাকআপ সতর্কতার নিয়ম
  scan/          পাতা স্ক্যান: parse.ts (নাম ও পাওয়ার চেনা), ocr.ts (ক্যামেরা ও ML Kit)
  csv.ts, i18n/, validation/
src/types/       ধরন
```

---

## ✏️ সংশোধন ও বাতিল

প্রতিটি তথ্য ইনপুটের জায়গায় সংশোধন ও বাতিলের ব্যবস্থা আছে।

- **মূল তথ্য** (ওষুধ, batch, পাওনাদার, খরচের ক্যাটাগরি) — সংশোধন করা যায়; কোনো লেনদেন না থাকলে সম্পূর্ণ মুছেও ফেলা যায়। লেনদেন থাকলে মোছা যায় না, ওষুধ ও পাওনাদার শুধু বন্ধ করা যায়, যাতে পুরোনো হিসাব ভেঙে না যায়।
- **আর্থিক রেকর্ড** (বিক্রয়, বাকি আদায়, খরচ, স্টক এন্ট্রি, স্টক সমন্বয়, রিটার্ন) — কারণ লিখে বাতিল করতে হয়। বাতিল করলে হিসাব সম্পূর্ণ উল্টে যায় (স্টক, বাকি ও ক্যাশ ঠিক হয়ে যায়), রেকর্ডটি "বাতিল" চিহ্ন নিয়ে তালিকায় থাকে এবং রিপোর্টে গণনা হয় না। এতে audit log অক্ষত থাকে।
- **টাকার অঙ্কে পয়সা** — সব দাম ও পরিমাণের ঘরে দশমিক লেখা যায়, যেমন ১২.৫০ টাকা।

## 🔐 নিরাপত্তা

PIN কখনো plain সংরক্ষণ হয় না (salt + বহু-রাউন্ড SHA-256) · ভুল PIN বারবার হলে lock · inactivity auto-lock · আর্থিক রেকর্ড permanent delete নেই (cancel/void) · সব গুরুত্বপূর্ণ পরিবর্তনে audit log · এনক্রিপ্টেড backup · সব ডেটা device-local, কোনো third-party/tracking নেই।

সম্পূর্ণ: [docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) · ব্যাকআপ: [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)

---

## 🧪 টেস্ট

```bash
npm run test        # vitest (money, business-rules, backup-status, scan-parse)
npm run typecheck
```

---

## 🚫 ইচ্ছাকৃতভাবে বাদ

ওষুধের অনলাইন ডেটাবেস (স্ক্যান শুধু পাতার লেখা পড়ে, ইন্টারনেট থেকে কিছু আনে না) · Supplier · Employee/staff · Multiple branch · Payroll · Online/auto payment ও বিকাশ/নগদ/রকেট/কার্ড API · Ecommerce/delivery · Bill/thermal/PDF/receipt printing · বিজ্ঞাপন/tracking/analytics · **cloud/backend সার্ভার**।

> মোবাইল ব্যাংকিং টাকা এলে **manual entry** হিসেবে রেকর্ড হয় — কোনো API নেই।

---

## ⚠️ মনে রাখবেন

সব ডেটা এই ব্রাউজার/ডিভাইসে। ব্রাউজার ডেটা মুছে ফেললে বা ডিভাইস নষ্ট হলে ডেটা হারাতে পারে — তাই **নিয়মিত এনক্রিপ্টেড ব্যাকআপ** (মেনু → ব্যাকআপ) নিয়ে USB/নিরাপদ ফোল্ডারে রাখুন।
