# আশ শিফা ফার্মেসী

> সহজ হিসাব, নিরাপদ ব্যবস্থাপনা — বাংলাদেশের ছোট গ্রামের ফার্মেসির জন্য একক-মালিক ব্যবস্থাপনা অ্যাপ।

সম্পূর্ণ **local, offline** PWA। কোনো ইন্টারনেট, সার্ভার বা অ্যাকাউন্ট লাগে না — সব ডেটা এই ডিভাইসেই (ব্রাউজারের IndexedDB) নিরাপদে থাকে। লগইন হয় **৮ সংখ্যার PIN** দিয়ে।

---

## ✨ প্রধান ফিচার

- **PIN লগইন** — ৮ সংখ্যার PIN (hashed), auto screen-lock, ভুল হলে temporary lock
- **ড্যাশবোর্ড** — আজকের বিক্রয়/নগদ/বাকি, আদায়, খরচ, আনুমানিক লাভ, মোট পাওনা, স্টক মূল্য, কম স্টক ও মেয়াদ সতর্কতা
- **বিক্রয়** — দ্রুত সার্চ, নগদ/বাকি/মিশ্র, ছাড়, স্টক auto কমে, FEFO, expired বিক্রি নিষিদ্ধ (কোনো bill/print নেই)
- **নতুন স্টক** — batch + expiry ভিত্তিক, নতুন ওষুধ তৈরি
- **ওষুধ ও স্টক** — সার্চ/ফিল্টার, কম স্টক (কমলা/লাল/সবুজ), মেয়াদ অবস্থা
- **পাওনাদার + বাকি আদায়** — profile, বর্তমান বাকি, overpayment রোধ
- **খরচ** — ক্যাটাগরি সহ
- **ক্যাশ হিসাব** — opening/actual, expected closing, difference
- **রিপোর্ট** — দৈনিক/মাসিক/ইনভেন্টরি + CSV export
- **বিক্রয় রিটার্ন** — restock flag, refund, due auto-adjust
- **স্টক সমন্বয়** — নষ্ট/হারানো/মেয়াদ/ভুল এন্ট্রি, কারণ বাধ্যতামূলক, audit
- **ব্যাকআপ/Restore** — Web Crypto (AES-GCM) এনক্রিপ্টেড, restore preview + safety backup
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
src/app/         পেজ: (auth)/login, (app)/dashboard…settings
src/components/  AppShell, StatCard
src/lib/
  auth.ts        PIN hash/verify/reset, session lock
  db/local.ts    Dexie DB (সব entity) + seed + export/import
  data.ts        সব ব্যবসায়িক নিয়ম ও হিসাব (transaction)
  money.ts       paisa utils
  business-rules.ts  low-stock / expiry / FEFO / due নিয়ম
  csv.ts, i18n/, validation/
src/types/       ধরন
```

---

## 🔐 নিরাপত্তা

PIN কখনো plain সংরক্ষণ হয় না (salt + বহু-রাউন্ড SHA-256) · ভুল PIN বারবার হলে lock · inactivity auto-lock · আর্থিক রেকর্ড permanent delete নেই (cancel/void) · সব গুরুত্বপূর্ণ পরিবর্তনে audit log · এনক্রিপ্টেড backup · সব ডেটা device-local, কোনো third-party/tracking নেই।

সম্পূর্ণ: [docs/SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) · ব্যাকআপ: [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)

---

## 🧪 টেস্ট

```bash
npm run test        # vitest (money, business-rules)
npm run typecheck
```

---

## 🚫 ইচ্ছাকৃতভাবে বাদ

Supplier · Employee/staff · Multiple branch · Payroll · Online/auto payment ও বিকাশ/নগদ/রকেট/কার্ড API · Ecommerce/delivery · Bill/thermal/PDF/receipt printing · বিজ্ঞাপন/tracking/analytics · **cloud/backend সার্ভার**।

> মোবাইল ব্যাংকিং টাকা এলে **manual entry** হিসেবে রেকর্ড হয় — কোনো API নেই।

---

## ⚠️ মনে রাখবেন

সব ডেটা এই ব্রাউজার/ডিভাইসে। ব্রাউজার ডেটা মুছে ফেললে বা ডিভাইস নষ্ট হলে ডেটা হারাতে পারে — তাই **নিয়মিত এনক্রিপ্টেড ব্যাকআপ** (মেনু → ব্যাকআপ) নিয়ে USB/নিরাপদ ফোল্ডারে রাখুন।
