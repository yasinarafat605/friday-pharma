-- Friday Pharma — কলাম স্তরের সুরক্ষা (ঝুঁকি R9)
--
-- **এই ফাইলটি সবার শেষে চালাতে হবে**, 03-permissions.sql-এর পরে।
-- Supabase নতুন টেবিলে নিজে থেকেই `grant all ... to authenticated` বসায়,
-- তাই এখানকার revoke সেটির পরেই কার্যকর হয়।
--
-- সমস্যাটি কী ছিল
--   RLS ঠিক করে দেয় কোন **সারি** দেখা যাবে, কিন্তু কোন **কলাম** তা নয়।
--   ক্যাশিয়ারের reports.read নেই, তাই তিনি রিপোর্টের পর্দা খুলতে পারতেন না —
--   কিন্তু sale_items থেকে সরাসরি select করে cost_price_paisa পড়ে ফেলতে
--   পারতেন, আর বিক্রয়মূল্য তো তাঁর সামনেই। অর্থাৎ মুনাফা বেরিয়ে যেত।
--   এটি অন্য দোকানে ফাঁস নয়, কিন্তু নিজের দোকানেই ভুল লোকের কাছে ফাঁস।
--
-- সমাধান দুই ভাগে
--   ১. ক্রয়মূল্যের কলামগুলো `authenticated` ভূমিকা থেকে তুলে নেওয়া হয়।
--      টেবিল-স্তরের grant থেকে একটি কলাম আলাদা করে revoke করা যায় না,
--      তাই টেবিলের select পুরো তুলে নিয়ে **অনুমোদিত কলামগুলোর তালিকা**
--      আবার grant করা হয়। নতুন কলাম যোগ করলে এখানেও যোগ করতে হবে —
--      নইলে সেটি কেউ পড়তে পারবে না। ভুলে ফাঁস হওয়ার চেয়ে এটাই ভালো।
--
--   ২. যাঁদের reports.read আছে তাঁরা নিচের view গুলো দিয়ে পড়েন।
--      View গুলো definer-অধিকারে চলে, তাই ভেতরে **দোকানের শর্তটি নিজেরাই
--      লেখে** — RLS-এর উপর ভরসা করে না। শর্তটি বাদ পড়লে সেটি cross-tenant
--      ফাঁস হতো, তাই test-isolation.sql-এ আলাদা করে পরীক্ষা করা হয়।

-- ============================================================
-- ১. ক্রয়মূল্যের কলাম তুলে নেওয়া
-- ============================================================
-- সুরক্ষিত কলাম তিনটি:
--   batches.purchase_price_paisa        ব্যাচ কত দামে কেনা
--   stock_entries.purchase_price_paisa  চালান কত দামে এসেছে
--   sale_items.cost_price_paisa         বিক্রীত মালের ক্রয়মূল্য
-- বিক্রয়মূল্য (sale_price_paisa, unit_price_paisa, line_total_paisa)
-- ইচ্ছে করেই খোলা — ক্যাশিয়ারকে বেচতে হলে দাম দেখতেই হবে। মুনাফা
-- লুকাতে ক্রয়মূল্য লুকালেই যথেষ্ট।

revoke select on batches       from authenticated;
revoke select on stock_entries from authenticated;
revoke select on sale_items    from authenticated;

grant select (
  id, pharmacy_id, medicine_id, batch_no, expiry_date,
  sale_price_paisa, qty_in_stock, updated_at, deleted_at
) on batches to authenticated;

grant select (
  id, pharmacy_id, client_txn_id, batch_id, qty,
  sale_price_paisa, entry_date, invoice_no, note,
  status, cancelled_reason, created_at, updated_at, deleted_at
) on stock_entries to authenticated;

grant select (
  id, pharmacy_id, sale_id, medicine_id, batch_id, qty,
  unit_price_paisa, line_total_paisa, updated_at, deleted_at
) on sale_items to authenticated;

-- লেখার অধিকার অপরিবর্তিত: ক্রয়মূল্য লেখা যায়, পড়া যায় না।
-- স্টক ঢোকানোর সময় ক্রয়মূল্য বসাতেই হয়, আর সেটি অনুমতির নিয়মেই বাঁধা।
grant insert, update, delete on batches, stock_entries, sale_items to authenticated;

-- ============================================================
-- ২. অনুমতি থাকলে পড়ার পথ
-- ============================================================
-- security_invoker বন্ধ (definer) — কারণ ডাকা ব্যক্তির কাছে কলামটির
-- অধিকারই নেই। তাই দোকানের শর্ত ও অনুমতি দুটোই view-এর ভেতরে লেখা।

create or replace view v_batch_costs
with (security_invoker = off) as
  select b.id,
         b.pharmacy_id,
         b.medicine_id,
         b.batch_no,
         b.expiry_date,
         b.qty_in_stock,
         b.purchase_price_paisa,
         b.sale_price_paisa,
         (b.sale_price_paisa - b.purchase_price_paisa) as margin_per_unit_paisa,
         b.updated_at,
         b.deleted_at
    from batches b
   where b.pharmacy_id = auth_pharmacy_id()
     and has_permission('reports.read');

create or replace view v_stock_entry_costs
with (security_invoker = off) as
  select e.id,
         e.pharmacy_id,
         e.batch_id,
         e.qty,
         e.purchase_price_paisa,
         e.sale_price_paisa,
         round(e.purchase_price_paisa * e.qty) as total_cost_paisa,
         e.entry_date,
         e.invoice_no,
         e.status,
         e.updated_at,
         e.deleted_at
    from stock_entries e
   where e.pharmacy_id = auth_pharmacy_id()
     and has_permission('reports.read');

create or replace view v_sale_item_costs
with (security_invoker = off) as
  select si.id,
         si.pharmacy_id,
         si.sale_id,
         si.medicine_id,
         si.batch_id,
         si.qty,
         si.unit_price_paisa,
         si.cost_price_paisa,
         si.line_total_paisa,
         (si.line_total_paisa - round(si.cost_price_paisa * si.qty)) as margin_paisa,
         si.updated_at,
         si.deleted_at
    from sale_items si
   where si.pharmacy_id = auth_pharmacy_id()
     and has_permission('reports.read');

grant select on v_batch_costs, v_stock_entry_costs, v_sale_item_costs to authenticated;

-- ============================================================
-- ৩. যাচাই — এই ফাইল চলেছে কিনা তা নিঃশব্দে অনুমান করা যাবে না
-- ============================================================
do $$
declare
  leaked text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ')
    into leaked
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and privilege_type = 'SELECT'
     and (table_name, column_name) in (
       ('batches',       'purchase_price_paisa'),
       ('stock_entries', 'purchase_price_paisa'),
       ('sale_items',    'cost_price_paisa')
     );

  if leaked is not null then
    raise exception 'ক্রয়মূল্যের কলাম এখনো খোলা: %', leaked;
  end if;

  raise notice 'ক্রয়মূল্যের তিনটি কলাম সুরক্ষিত; পড়ার পথ v_*_costs view';
end $$;
