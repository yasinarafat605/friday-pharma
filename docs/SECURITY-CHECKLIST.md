# নিরাপত্তা চেকলিস্ট — আশ শিফা ফার্মেসী (local-only)

## Authentication (PIN)
- [x] ৮ সংখ্যার PIN — কখনো plain সংরক্ষণ নয় (salt + ৫০০০-রাউন্ড SHA-256, Web Crypto)
- [x] ভুল PIN বারবার (৫ বার) → temporary lock (১ মিনিট)
- [x] Inactivity auto screen-lock (সেটিংসযোগ্য) — খুলতে PIN লাগে
- [x] Logout/লক → session flag মুছে যায়
- [x] PIN পরিবর্তন (সেটিংস)
- [x] PIN রিসেট শুধু ফোন নম্বরের শেষ ৪ সংখ্যা দিয়ে (device-local knowledge factor)

## ডেটা
- [x] সব ডেটা device-local (IndexedDB) — কোনো cloud/সার্ভারে যায় না
- [x] Negative stock/expense/total রোধ (transaction-এ যাচাই)
- [x] Expired বিক্রি রোধ · Due overpayment রোধ · Stock-এর বেশি বিক্রি রোধ
- [x] Duplicate submission রোধ (unique client_txn_id)
- [x] Adjustment-এ কারণ বাধ্যতামূলক

## Application
- [x] Input validation (client) — সব ফর্মে
- [x] XSS রোধ (React auto-escaping; কোনো dangerouslySetInnerHTML নেই)
- [x] Security headers (next.config.mjs)
- [x] কোনো secret/key frontend-এ নেই (backend-ই নেই)
- [x] Production source maps off

## আর্থিক রেকর্ড
- [x] Sale/payment/expense/adjustment permanent delete নেই — cancel/void
- [x] Audit log (কী, আগের/নতুন value, সময়, device)
- [x] Cancelled transaction আলাদা status

## Backup
- [x] Encrypted backup (AES-GCM, PBKDF2)
- [x] Restore preview + পাসফ্রেজ/corruption যাচাই + restore-এর আগে safety backup
- [ ] স্বয়ংক্রিয় দৈনিক/সাপ্তাহিক reminder (পরের ধাপ)

## Privacy
- [x] পাওনাদার তথ্য device-local ও private
- [x] কোনো third-party analytics / ad SDK / tracking নেই

## মনে রাখবেন
- ডেটা ডিভাইস-নির্ভর — ব্রাউজার ডেটা মুছলে/ডিভাইস নষ্ট হলে হারাতে পারে। **নিয়মিত এনক্রিপ্টেড ব্যাকআপ নিন।**
- ব্যাকআপ পাসফ্রেজ হারালে ফাইল অকেজো — নিরাপদে সংরক্ষণ করুন।
