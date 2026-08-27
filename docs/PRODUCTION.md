# Production Build গাইড

```bash
npm run build
npm run start     # default :3000
```

## Deploy
যেকোনো static/Node host-এ চলে (কোনো database/env দরকার নেই):
- **Vercel**: GitHub-এ push → import → framework Next.js → deploy।
- **নিজের সার্ভার**: `npm run build` তারপর `npm run start` (বা reverse-proxy সহ)।

যেহেতু সব ডেটা ব্যবহারকারীর ব্রাউজারে (IndexedDB), সার্ভার শুধু app ফাইল serve করে — কোনো ব্যাকএন্ড state নেই।

## Production চেক
- `npm run typecheck` ও `npm run test` পাস।
- HTTPS ব্যবহার করুন (PWA install ও Web Crypto-র জন্য নিরাপদ context)।
- PWA আইকন যোগ করুন: `public/icons/icon-192.png`, `icon-512.png`।
- [docs/SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md) দেখে নিন।

## গুরুত্বপূর্ণ
ব্যবহারকারীকে বলুন **নিয়মিত এনক্রিপ্টেড ব্যাকআপ** নিতে (মেনু → ব্যাকআপ), কারণ ডেটা device-local।
