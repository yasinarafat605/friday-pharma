# টেস্ট নির্দেশনা

```bash
npm run test        # unit tests (vitest)
npm run typecheck   # TypeScript type-check
```

## অন্তর্ভুক্ত unit test
- `src/lib/__tests__/money.test.ts` — paisa রূপান্তর, বাংলা সংখ্যা, floating-point নিরাপত্তা।
- `src/lib/__tests__/business-rules.test.ts` — low-stock (সিরাপ ≤১, ট্যাবলেট/ক্যাপসুল ≤১০), expiry 90/60/30/expired, due overpayment, sale qty, FEFO।

## পরিকল্পিত টেস্ট (Section ২২ Phase 5)
| টেস্ট | কোথায় |
|---|---|
| Form validation | Zod schemas (`src/lib/validation`) + component test |
| Stock calculation | `create_sale`/`add_stock` RPC — Supabase test DB-তে integration |
| Due calculation | `record_due_payment` + `recompute_customer_due` |
| Profit calculation | sale_items cost vs sale price aggregate |
| Expiry validation | expired batch বিক্রয়ে RPC exception |
| Low-stock alert | `v_stock_status` view output |
| Duplicate submission | একই `client_txn_id` দুইবার → একই row |
| Backup/restore | encrypt → decrypt round-trip |
| Auth security | failed-attempt lock, RLS cross-owner denial |
| Offline mode | outbox enqueue → online flush idempotent |

## ম্যানুয়াল offline টেস্ট
1. dev server চালান, লগইন করুন।
2. DevTools → Network → Offline।
3. একটি বিক্রয় করুন → "সংরক্ষিত (অফলাইন)" বার্তা।
4. Online করুন → কয়েক সেকেন্ডে auto-sync (outbox flush); duplicate তৈরি হবে না।

## RPC/DB নিয়ম যাচাই (Supabase SQL Editor)
- Expired বিক্রয় → `create_sale` exception ("মেয়াদোত্তীর্ণ … বিক্রি করা যাবে না")।
- Overpay → `record_due_payment` exception।
- Negative stock → CHECK constraint violation।
- Financial row delete → `forbid_delete` trigger exception।
