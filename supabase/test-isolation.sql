-- Friday Pharma — বিচ্ছিন্নতার পরীক্ষা (isolation test)
--
-- policy বদলালেই এটি আবার চালান। মুখস্থ নয়, প্রমাণ।
--   bash supabase/run-isolation-test.sh
--
-- চালানোর ক্রম: 00-test-harness.sql → 01-schema.sql → 02-policies.sql
--               → 03-permissions.sql → এই ফাইল
--
-- একটি ক্ষেত্রেও ব্যর্থ হলে শেষে exception ওঠে, তাই CI-তেও ব্যবহার করা যায়।

-- ============================================================
-- পরীক্ষার যন্ত্রপাতি
-- ============================================================

drop table if exists t_results;
create table t_results (
  id     serial primary key,
  grp    text,
  label  text,
  passed boolean,
  detail text
);
grant all on t_results to authenticated;
grant all on sequence t_results_id_seq to authenticated;

-- কতগুলো সারি দেখা যায়
create or replace function t_count(grp text, label text, q text, expected bigint)
returns void language plpgsql as $$
declare n bigint;
begin
  execute q into n;
  insert into t_results(grp, label, passed, detail)
  values (grp, label, n = expected, format('%s সারি (আশা %s)', n, expected));
exception when others then
  insert into t_results(grp, label, passed, detail)
  values (grp, label, false, 'অপ্রত্যাশিত ত্রুটি ' || sqlstate || ': ' || sqlerrm);
end $$;

-- আটকে যাওয়া উচিত। RLS-এ দুই রকম "না": ত্রুটি, অথবা শূন্য সারি।
-- দুটোই গ্রহণযোগ্য; কিন্তু syntax ত্রুটিকে সাফল্য বলে ভুল করা চলবে না,
-- তাই কেবল নিরাপত্তা-সংক্রান্ত sqlstate গোনা হয়।
create or replace function t_blocked(grp text, label text, q text)
returns void language plpgsql as $$
declare n bigint;
begin
  execute q;
  get diagnostics n = row_count;
  insert into t_results(grp, label, passed, detail)
  values (grp, label, n = 0, format('%s সারি প্রভাবিত (আশা ০)', n));
exception when others then
  insert into t_results(grp, label, passed, detail)
  values (grp, label,
          sqlstate in ('42501','23514','23505','23503','P0001'),
          'আটকেছে ' || sqlstate || ': ' || split_part(sqlerrm, E'\n', 1));
end $$;

-- সফল হওয়া উচিত
create or replace function t_allowed(grp text, label text, q text)
returns void language plpgsql as $$
begin
  execute q;
  insert into t_results(grp, label, passed, detail) values (grp, label, true, 'সফল');
exception when others then
  insert into t_results(grp, label, passed, detail)
  values (grp, label, false, 'আটকে গেছে ' || sqlstate || ': ' || split_part(sqlerrm, E'\n', 1));
end $$;

-- একটি মান মিলছে কিনা
create or replace function t_value(grp text, label text, q text, expected text)
returns void language plpgsql as $$
declare v text;
begin
  execute q into v;
  insert into t_results(grp, label, passed, detail)
  values (grp, label, coalesce(v, '<null>') = expected,
          format('পেয়েছি %s (আশা %s)', coalesce(v, '<null>'), expected));
exception when others then
  insert into t_results(grp, label, passed, detail)
  values (grp, label, false, 'অপ্রত্যাশিত ত্রুটি ' || sqlstate || ': ' || sqlerrm);
end $$;

grant execute on function t_count(text,text,text,bigint)  to authenticated;
grant execute on function t_blocked(text,text,text)       to authenticated;
grant execute on function t_allowed(text,text,text)       to authenticated;
grant execute on function t_value(text,text,text,text)    to authenticated;

-- ============================================================
-- মঞ্চ সাজানো (superuser হিসেবে, RLS ছাড়া)
-- ============================================================
--
--   ফার্মেসি A  — মালিক UA, ম্যানেজার UM, ক্যাশিয়ার UC,
--                 স্টক কর্মী UI, হিসাবরক্ষক UAC
--   ফার্মেসি B  — মালিক UB
--   UM একই সাথে B-তেও ক্যাশিয়ার (একাধিক সদস্যপদ পরীক্ষার জন্য)
--   UX          — লগইন আছে, কোনো সদস্যপদ নেই (F1-এর আক্রমণকারী)

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),  -- UA  owner A
  ('22222222-2222-2222-2222-222222222222'),  -- UB  owner B
  ('33333333-3333-3333-3333-333333333333'),  -- UM  manager A + cashier B
  ('44444444-4444-4444-4444-444444444444'),  -- UC  cashier A
  ('55555555-5555-5555-5555-555555555555'),  -- UI  inventory A
  ('66666666-6666-6666-6666-666666666666'),  -- UAC accountant A
  ('99999999-9999-9999-9999-999999999999');  -- UX  কোনো সদস্যপদ নেই

insert into pharmacies (id, name, created_by) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1', 'ফার্মেসি A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'ফার্মেসি B', '22222222-2222-2222-2222-222222222222'),
  -- কেউ এখনো দাবি করেনি, UX তৈরি করেনি — bootstrap পরীক্ষার লক্ষ্য
  ('cccccccc-0000-0000-0000-0000000000c1', 'ফার্মেসি C', '22222222-2222-2222-2222-222222222222');

insert into memberships (user_id, pharmacy_id, role, is_default) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'owner',      true),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'owner',      true),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'manager',    true),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'cashier',    false),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'cashier',    true),
  ('55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'inventory',  true),
  ('66666666-6666-6666-6666-666666666666', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'accountant', true);

insert into app_settings (pharmacy_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000a1'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1');

insert into customers (id, pharmacy_id, name) values
  ('c0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'গ্রাহক A'),
  ('c0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'গ্রাহক B');

insert into medicines (id, pharmacy_id, name, type, unit) values
  ('d0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'নাপা', 'tablet', 'pcs'),
  ('d0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'সেকলো', 'capsule', 'pcs');

insert into batches (id, pharmacy_id, medicine_id, qty_in_stock) values
  ('e0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 50),
  ('e0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 40);

insert into sales (id, pharmacy_id, client_txn_id, txn_no, sale_date, payment_type, total_paisa) values
  ('f0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'txn-a1', 'S-A-1', now(), 'cash', 1000),
  ('f0000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'txn-b1', 'S-B-1', now(), 'cash', 2000);

insert into stock_movements (id, pharmacy_id, batch_id, medicine_id, qty_delta, reason, business_date, client_txn_id) values
  ('a1000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'e0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 50, 'purchase', '2026-09-01', 'mv-a1'),
  ('a1000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1',
   'e0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 40, 'purchase', '2026-09-01', 'mv-b1');

insert into expense_categories (id, pharmacy_id, name, bn_name) values
  ('b0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'others', 'অন্যান্য');

insert into invites (code, pharmacy_id, role) values
  ('INVITE-A-7f3c9d2e', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'cashier'),
  ('INVITE-B-1b8e4a05', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'manager');

-- ============================================================
-- ১। মূল বিচ্ছিন্নতা — P1 থেকে অপরিবর্তিত, সবগুলো এখনো পাস করা চাই
-- ============================================================

set role authenticated;
set app.uid = '11111111-1111-1111-1111-111111111111';   -- মালিক A
reset app.active_pharmacy;

select t_count('১ মূল', 'মালিক শুধু নিজের গ্রাহক দেখেন',
  'select count(*) from customers', 1);
select t_count('১ মূল', 'অন্য দোকানের সারি id দিয়ে চাইলেও শূন্য, ত্রুটি নয়',
  $$select count(*) from customers where pharmacy_id='bbbbbbbb-0000-0000-0000-0000000000b1'$$, 0);
select t_blocked('১ মূল', 'অন্য দোকানে লেখা যায় না',
  $$insert into customers (id, pharmacy_id, name)
    values (gen_random_uuid(),'bbbbbbbb-0000-0000-0000-0000000000b1','অনুপ্রবেশ')$$);
select t_blocked('১ মূল', 'নিজের সারি অন্য দোকানে সরানো যায় না',
  $$update customers set pharmacy_id='bbbbbbbb-0000-0000-0000-0000000000b1'
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('১ মূল', 'আর্থিক রেকর্ড মোছা যায় না',
  $$delete from sales where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_count('১ মূল', 'অন্য দোকানের ওষুধ দেখা যায় না',
  'select count(*) from medicines', 1);

-- লগইন ছাড়া কেউ কিছুই দেখে না
set app.uid = '';
select t_count('১ মূল', 'লগইন ছাড়া গ্রাহক শূন্য',   'select count(*) from customers', 0);
select t_count('১ মূল', 'লগইন ছাড়া বিক্রয় শূন্য',   'select count(*) from sales', 0);
select t_count('১ মূল', 'লগইন ছাড়া নড়াচড়া শূন্য',  'select count(*) from stock_movements', 0);

-- ============================================================
-- ২। F1 — যার সদস্যপদ নেই, সে কোনো দোকানের মালিক হতে পারে না
-- ============================================================
--
-- Pre-P3 audit-এ এটিই সরাসরি করে দেখানো হয়েছিল: সদস্যপদহীন একজন
-- profiles-এ নিজের সারি ঢুকিয়ে একটি অচেনা pharmacy_id-এর মালিক হয়ে
-- যেতেন, তারপর সেই দোকানের বিক্রয় ও গ্রাহক পড়তে পারতেন।

set app.uid = '99999999-9999-9999-9999-999999999999';   -- UX, কোনো সদস্যপদ নেই
reset app.active_pharmacy;

select t_blocked('২ F1', 'সদস্যপদহীন ব্যবহারকারী A-এর মালিক হতে পারেন না',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'aaaaaaaa-0000-0000-0000-0000000000a1','owner')$$);
select t_blocked('২ F1', 'ক্যাশিয়ার সেজেও ঢোকা যায় না',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'aaaaaaaa-0000-0000-0000-0000000000a1','cashier')$$);
select t_blocked('২ F1', 'অন্যের তৈরি দাবিহীন দোকানও দখল করা যায় না',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'cccccccc-0000-0000-0000-0000000000c1','owner')$$);
select t_count('২ F1', 'দখলের চেষ্টার পরেও A-এর বিক্রয় অদৃশ্য', 'select count(*) from sales', 0);
select t_count('২ F1', 'দখলের চেষ্টার পরেও A-এর গ্রাহক অদৃশ্য', 'select count(*) from customers', 0);
select t_value('২ F1', 'সদস্যপদহীন ব্যবহারকারীর চালু দোকান null',
  'select auth_pharmacy_id()::text', '<null>');

-- বৈধ পথটি কাজ করে: নিজের তৈরি দাবিহীন দোকানে নিজেকে মালিক বসানো
set app.uid = '77777777-7777-7777-7777-777777777777';
reset role;
insert into auth.users (id) values ('77777777-7777-7777-7777-777777777777');
set role authenticated;
select t_allowed('২ F1', 'বৈধ পথ: নিজের তৈরি দোকান খোলা',
  $$insert into pharmacies (id, name, created_by)
    values ('dddddddd-0000-0000-0000-0000000000d1','ফার্মেসি D',
            '77777777-7777-7777-7777-777777777777')$$);
select t_allowed('২ F1', 'বৈধ পথ: নিজের তৈরি দোকানের মালিক হওয়া',
  $$insert into memberships (user_id, pharmacy_id, role, is_default)
    values ('77777777-7777-7777-7777-777777777777',
            'dddddddd-0000-0000-0000-0000000000d1','owner',true)$$);
-- এখন D-এর মালিক আছে, তাই বাইরের কেউ আর দাবি করতে পারবেন না
set app.uid = '99999999-9999-9999-9999-999999999999';
select t_blocked('২ F1', 'দাবি হয়ে যাওয়া দোকান আর দখল করা যায় না',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'dddddddd-0000-0000-0000-0000000000d1','owner')$$);

-- ============================================================
-- ৩। F5 — আমন্ত্রণ কোড অন্য দোকানের দেখা বা তালিকা করা যায় না
-- ============================================================

set app.uid = '11111111-1111-1111-1111-111111111111';   -- মালিক A
reset app.active_pharmacy;

select t_count('৩ F5', 'মালিক শুধু নিজের দোকানের কোড দেখেন',
  'select count(*) from invites', 1);
select t_count('৩ F5', 'অন্য দোকানের কোড চাইলেও শূন্য',
  $$select count(*) from invites where pharmacy_id='bbbbbbbb-0000-0000-0000-0000000000b1'$$, 0);
select t_count('৩ F5', 'কোড জানা থাকলেও অন্য দোকানের সারি পড়া যায় না',
  $$select count(*) from invites where code='INVITE-B-1b8e4a05'$$, 0);

set app.uid = '44444444-4444-4444-4444-444444444444';   -- ক্যাশিয়ার A
select t_count('৩ F5', 'ক্যাশিয়ার নিজের দোকানের কোডও দেখতে পান না',
  'select count(*) from invites', 0);

set app.uid = '99999999-9999-9999-9999-999999999999';   -- সদস্যপদহীন
select t_count('৩ F5', 'সদস্যপদহীন ব্যবহারকারী কোনো কোড দেখেন না',
  'select count(*) from invites', 0);
select t_count('৩ F5', 'তালিকা করে দেখার চেষ্টাতেও শূন্য',
  $$select count(*) from invites where expires_at > now()$$, 0);
-- সম্পূর্ণ কোড জানা থাকলে যাচাই করা যায় — কিন্তু সেটি ফাংশন, টেবিল নয়
select t_count('৩ F5', 'সম্পূর্ণ কোড দিয়ে যাচাই করা যায় (যোগ দেওয়ার পথ)',
  $$select count(*) from invite_preview('INVITE-B-1b8e4a05')$$, 1);
select t_count('৩ F5', 'ভুল কোডে কিছুই ফেরে না',
  $$select count(*) from invite_preview('INVITE-B-ভুল')$$, 0);

-- ============================================================
-- ৪। চালু দোকানের resolver — দাবি সবসময় যাচাই হয়
-- ============================================================

set app.uid = '11111111-1111-1111-1111-111111111111';   -- মালিক A

set app.active_pharmacy = 'bbbbbbbb-0000-0000-0000-0000000000b1';   -- সদস্য নন
select t_value('৪ resolver', 'যে দোকানের সদস্য নন তা দাবি করলে null',
  'select auth_pharmacy_id()::text', '<null>');
select t_count('৪ resolver', 'ভুল দাবির সাথে গ্রাহক শূন্য', 'select count(*) from customers', 0);
select t_count('৪ resolver', 'ভুল দাবির সাথে বিক্রয় শূন্য', 'select count(*) from sales', 0);
select t_count('৪ resolver', 'ভুল দাবি নিজের দোকানে গড়িয়ে যায় না',
  $$select count(*) from customers where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$, 0);

set app.active_pharmacy = 'aaaaaaaa-0000-0000-0000-0000000000a1';   -- বৈধ দাবি
select t_count('৪ resolver', 'বৈধ দাবিতে নিজের দোকান ফেরে', 'select count(*) from customers', 1);

set app.active_pharmacy = 'not-a-uuid';
select t_value('৪ resolver', 'আজেবাজে দাবিতে null, ত্রুটি নয়',
  'select auth_pharmacy_id()::text', '<null>');
reset app.active_pharmacy;

-- একাধিক সদস্যপদ: UM একই সাথে A-তে ম্যানেজার আর B-তে ক্যাশিয়ার
set app.uid = '33333333-3333-3333-3333-333333333333';
reset app.active_pharmacy;
select t_value('৪ resolver', 'দাবি না থাকলে ডিফল্ট দোকান খোলে',
  'select auth_pharmacy_id()::text', 'aaaaaaaa-0000-0000-0000-0000000000a1');
select t_count('৪ resolver', 'একবারে একটিই দোকান দেখা যায়', 'select count(*) from customers', 1);
select t_value('৪ resolver', 'দেখা যাচ্ছে A-এর গ্রাহক',
  'select name from customers', 'গ্রাহক A');

set app.active_pharmacy = 'bbbbbbbb-0000-0000-0000-0000000000b1';
select t_value('৪ resolver', 'দোকান বদলালে দৃশ্যও বদলায়',
  'select name from customers', 'গ্রাহক B');
select t_count('৪ resolver', 'বদলানোর পরেও একবারে একটিই', 'select count(*) from customers', 1);
reset app.active_pharmacy;

-- ============================================================
-- ৫। ভূমিকা ও অনুমতির সীমা — পাঁচটি ভূমিকাই
-- ============================================================

-- মালিক: সব পারেন
set app.uid = '11111111-1111-1111-1111-111111111111';
select t_value('৫ owner', 'মালিকের billing.manage আছে',
  $$select has_permission('billing.manage')::text$$, 'true');
select t_value('৫ owner', 'মালিকের members.manage আছে',
  $$select has_permission('members.manage')::text$$, 'true');
select t_allowed('৫ owner', 'মালিক সেটিংস বদলাতে পারেন',
  $$update app_settings set locale='bn'
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_allowed('৫ owner', 'মালিক বিক্রয় বাতিল করতে পারেন',
  $$update sales set status='cancelled'
    where id='f0000000-0000-0000-0000-0000000000a1'$$);

-- ম্যানেজার: দোকান চালান, কিন্তু সদস্য বা বিলিং নয়
set app.uid = '33333333-3333-3333-3333-333333333333';
select t_value('৫ manager', 'ম্যানেজারের sales.cancel আছে',
  $$select has_permission('sales.cancel')::text$$, 'true');
select t_value('৫ manager', 'ম্যানেজারের members.manage নেই',
  $$select has_permission('members.manage')::text$$, 'false');
select t_value('৫ manager', 'ম্যানেজারের billing.manage নেই',
  $$select has_permission('billing.manage')::text$$, 'false');
select t_blocked('৫ manager', 'ম্যানেজার সদস্য যোগ করতে পারেন না',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'aaaaaaaa-0000-0000-0000-0000000000a1','cashier')$$);
select t_blocked('৫ manager', 'ম্যানেজার আমন্ত্রণ কোড বানাতে পারেন না',
  $$insert into invites (code, pharmacy_id, role)
    values ('INVITE-X-0001','aaaaaaaa-0000-0000-0000-0000000000a1','owner')$$);
select t_allowed('৫ manager', 'ম্যানেজার স্টক ঢোকাতে পারেন',
  $$insert into batches (id, pharmacy_id, medicine_id, qty_in_stock)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1',
            'd0000000-0000-0000-0000-0000000000a1',10)$$);

-- ক্যাশিয়ার: বেচতে পারেন, বাতিল করতে পারেন না
set app.uid = '44444444-4444-4444-4444-444444444444';
select t_value('৫ cashier', 'ক্যাশিয়ারের sales.create আছে',
  $$select has_permission('sales.create')::text$$, 'true');
select t_value('৫ cashier', 'ক্যাশিয়ারের sales.cancel নেই',
  $$select has_permission('sales.cancel')::text$$, 'false');
select t_value('৫ cashier', 'ক্যাশিয়ারের reports.read নেই',
  $$select has_permission('reports.read')::text$$, 'false');
select t_allowed('৫ cashier', 'ক্যাশিয়ার বিক্রয় করতে পারেন',
  $$insert into sales (id, pharmacy_id, client_txn_id, txn_no, sale_date, payment_type, total_paisa)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1',
            'txn-c1','S-A-2',now(),'cash',500)$$);
select t_blocked('৫ cashier', 'ক্যাশিয়ার বিক্রয় বাতিল করতে পারেন না',
  $$update sales set status='cancelled'
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('৫ cashier', 'ক্যাশিয়ার সেটিংস বদলাতে পারেন না',
  $$update app_settings set locale='en'
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('৫ cashier', 'ক্যাশিয়ার ওষুধের দাম বদলাতে পারেন না',
  $$update batches set sale_price_paisa=9999
    where id='e0000000-0000-0000-0000-0000000000a1'$$);
select t_allowed('৫ cashier', 'ক্যাশিয়ার বাকি আদায় করতে পারেন',
  $$insert into due_payments (id, pharmacy_id, client_txn_id, receipt_ref, customer_id,
                               pay_date, amount_paisa, method)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1','txn-d1','R-1',
            'c0000000-0000-0000-0000-0000000000a1',current_date,100,'cash')$$);

-- স্টক কর্মী: স্টক ও ওষুধ, টাকা নয়
set app.uid = '55555555-5555-5555-5555-555555555555';
select t_value('৫ inventory', 'স্টক কর্মীর stock.write আছে',
  $$select has_permission('stock.write')::text$$, 'true');
select t_value('৫ inventory', 'স্টক কর্মীর sales.create নেই',
  $$select has_permission('sales.create')::text$$, 'false');
select t_value('৫ inventory', 'স্টক কর্মীর reports.read নেই',
  $$select has_permission('reports.read')::text$$, 'false');
select t_allowed('৫ inventory', 'স্টক কর্মী ওষুধ যোগ করতে পারেন',
  $$insert into medicines (id, pharmacy_id, name, type, unit)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1','সেফ৩','capsule','pcs')$$);
select t_blocked('৫ inventory', 'স্টক কর্মী বিক্রয় করতে পারেন না',
  $$insert into sales (id, pharmacy_id, client_txn_id, txn_no, sale_date, payment_type, total_paisa)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1','txn-i1','S-A-3',now(),'cash',100)$$);
select t_blocked('৫ inventory', 'স্টক কর্মী খরচ লিখতে পারেন না',
  $$insert into expenses (id, pharmacy_id, client_txn_id, expense_date, category_id, amount_paisa)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1','txn-i2',current_date,
            'b0000000-0000-0000-0000-0000000000a1',100)$$);

-- হিসাবরক্ষক: সব পড়েন, কিছুই বদলান না
set app.uid = '66666666-6666-6666-6666-666666666666';
select t_value('৫ accountant', 'হিসাবরক্ষকের reports.read আছে',
  $$select has_permission('reports.read')::text$$, 'true');
select t_count('৫ accountant', 'হিসাবরক্ষক বিক্রয় পড়তে পারেন',
  $$select count(*) from sales where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$, 2);
select t_count('৫ accountant', 'হিসাবরক্ষক নড়াচড়ার ইতিহাস পড়তে পারেন',
  'select count(*) from stock_movements', 1);
select t_blocked('৫ accountant', 'হিসাবরক্ষক বিক্রয় লিখতে পারেন না',
  $$insert into sales (id, pharmacy_id, client_txn_id, txn_no, sale_date, payment_type, total_paisa)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1','txn-ac1','S-A-4',now(),'cash',100)$$);
select t_blocked('৫ accountant', 'হিসাবরক্ষক গ্রাহক বদলাতে পারেন না',
  $$update customers set name='বদলানো'
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('৫ accountant', 'হিসাবরক্ষক স্টক বদলাতে পারেন না',
  $$update batches set qty_in_stock=0
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('৫ accountant', 'হিসাবরক্ষক নড়াচড়া লিখতে পারেন না',
  $$insert into stock_movements (id, pharmacy_id, batch_id, medicine_id, qty_delta, reason, business_date, client_txn_id)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1',
            'e0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1',
            5,'purchase','2026-09-02','mv-ac1')$$);

-- ============================================================
-- ৬। নিজের ভূমিকা নিজে বাড়ানো যায় না
-- ============================================================

set app.uid = '44444444-4444-4444-4444-444444444444';   -- ক্যাশিয়ার
select t_blocked('৬ escalation', 'ক্যাশিয়ার নিজেকে মালিক বানাতে পারেন না',
  $$update memberships set role='owner'
    where user_id='44444444-4444-4444-4444-444444444444'$$);
select t_blocked('৬ escalation', 'ক্যাশিয়ার নিজেকে ম্যানেজার বানাতে পারেন না',
  $$update memberships set role='manager'
    where user_id='44444444-4444-4444-4444-444444444444'$$);
select t_value('৬ escalation', 'ভূমিকা ক্যাশিয়ারই আছে',
  $$select role::text from memberships where user_id='44444444-4444-4444-4444-444444444444'$$,
  'cashier');
select t_allowed('৬ escalation', 'নিজের নাম বদলানো যায়',
  $$update memberships set full_name='করিম'
    where user_id='44444444-4444-4444-4444-444444444444'$$);

-- মালিক সদস্য বানাতে পারেন, কিন্তু মালিক বানাতে পারেন কেবল মালিকই
set app.uid = '11111111-1111-1111-1111-111111111111';
select t_allowed('৬ escalation', 'মালিক নতুন ক্যাশিয়ার যোগ করতে পারেন',
  $$insert into memberships (user_id, pharmacy_id, role)
    values ('99999999-9999-9999-9999-999999999999',
            'aaaaaaaa-0000-0000-0000-0000000000a1','cashier')$$);

-- ============================================================
-- ৭। সদস্যপদ সরালে সাথে সাথেই অধিকার শেষ
-- ============================================================

set app.uid = '99999999-9999-9999-9999-999999999999';   -- এইমাত্র ক্যাশিয়ার হয়েছেন
select t_count('৭ removal', 'যোগ দেওয়ার পর দোকান দেখা যায়', 'select count(*) from customers', 1);

set app.uid = '11111111-1111-1111-1111-111111111111';   -- মালিক সরিয়ে দেন
select t_allowed('৭ removal', 'মালিক সদস্য সরাতে পারেন',
  $$delete from memberships
    where user_id='99999999-9999-9999-9999-999999999999'
      and pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);

set app.uid = '99999999-9999-9999-9999-999999999999';
select t_count('৭ removal', 'সরানোর সাথে সাথেই গ্রাহক অদৃশ্য', 'select count(*) from customers', 0);
select t_count('৭ removal', 'সরানোর সাথে সাথেই বিক্রয় অদৃশ্য', 'select count(*) from sales', 0);
select t_value('৭ removal', 'চালু দোকান আবার null',
  'select auth_pharmacy_id()::text', '<null>');

-- মালিক নিজেকে সরাতে পারেন না (দোকান মালিকহীন হয়ে যেত)
set app.uid = '11111111-1111-1111-1111-111111111111';
select t_blocked('৭ removal', 'অন্য দোকানের সদস্য সরানো যায় না',
  $$delete from memberships where pharmacy_id='bbbbbbbb-0000-0000-0000-0000000000b1'$$);

-- ============================================================
-- ৮। স্টকের নড়াচড়া — P2b-এর নিয়ম নতুন কাঠামোতেও অটুট
-- ============================================================

set app.uid = '11111111-1111-1111-1111-111111111111';
reset app.active_pharmacy;

select t_count('৮ movements', 'নিজের দোকানের নড়াচড়াই কেবল দেখা যায',
  'select count(*) from stock_movements', 1);
select t_count('৮ movements', 'অন্য দোকানের নড়াচড়া চাইলেও শূন্য',
  $$select count(*) from stock_movements
    where pharmacy_id='bbbbbbbb-0000-0000-0000-0000000000b1'$$, 0);
select t_blocked('৮ movements', 'অন্য দোকানে নড়াচড়া লেখা যায় না',
  $$insert into stock_movements (id, pharmacy_id, batch_id, medicine_id, qty_delta, reason, business_date, client_txn_id)
    values (gen_random_uuid(),'bbbbbbbb-0000-0000-0000-0000000000b1',
            'e0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-0000000000b1',
            1,'sale','2026-09-02','mv-evil')$$);
select t_blocked('৮ movements', 'নড়াচড়া বদলানো যায় না',
  $$update stock_movements set qty_delta=999
    where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_blocked('৮ movements', 'নড়াচড়া মোছা যায় না',
  $$delete from stock_movements where pharmacy_id='aaaaaaaa-0000-0000-0000-0000000000a1'$$);
select t_allowed('৮ movements', 'নিজের দোকানে নড়াচড়া যোগ করা যায়',
  $$insert into stock_movements (id, pharmacy_id, batch_id, medicine_id, qty_delta, reason, business_date, client_txn_id)
    values (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-0000000000a1',
            'e0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000a1',
            -1,'sale','2026-09-02','mv-a2')$$);

-- ============================================================
-- ফলাফল
-- ============================================================

reset role;
reset app.uid;
reset app.active_pharmacy;

\echo ''
\echo '================ বিচ্ছিন্নতার পরীক্ষা ================'
select grp as "বিভাগ",
       count(*) filter (where passed) as "পাস",
       count(*) filter (where not passed) as "ব্যর্থ"
  from t_results group by grp order by grp;

\echo ''
\echo '---- ব্যর্থ (কিছু না থাকলেই ভালো) ----'
select label as "পরীক্ষা", detail as "বিবরণ"
  from t_results where not passed order by id;

do $$
declare
  bad int;
  tot int;
begin
  select count(*) filter (where not passed), count(*) into bad, tot from t_results;
  if bad > 0 then
    raise exception 'বিচ্ছিন্নতার পরীক্ষা ব্যর্থ: % / % টি ক্ষেত্রে', bad, tot;
  end if;
  raise notice 'সব ঠিক আছে — % টি ক্ষেত্রেই পাস', tot;
end $$;
