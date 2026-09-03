-- Friday Pharma — ভূমিকা থেকে অনুমতি
--
-- Policy-তে কখনো ভূমিকার নাম লেখা হয় না, লেখা হয় অনুমতির নাম।
-- কে কী পারবে তা বদলাতে হলে এই ফাইলের সারি বদলান — policy ছোঁয়ার দরকার নেই।
-- নতুন ভূমিকা যোগ করাও তাই কয়েকটি insert, schema migration নয়।
--
-- অনুমতির তালিকা
--   records.read     ব্যবসার সারি আদৌ দেখা
--   sales.create     বিক্রয় করা
--   sales.cancel     বিক্রয়, রিটার্ন, সমন্বয় বা এন্ট্রি বাতিল করা
--   due.collect      বাকি আদায় করা
--   stock.write      স্টক ঢোকানো ও সমন্বয় করা
--   medicines.write  ওষুধ ও ব্যাচের তথ্য বদলানো (দাম সহ)
--   customers.write  গ্রাহকের তথ্য বদলানো
--   expenses.write   খরচ লেখা
--   cash.write       দিনের ক্যাশ মেলানো
--   reports.read     টাকার হিসাব, মুনাফা, রিপোর্ট ও export
--   settings.write   দোকানের সেটিংস বদলানো
--   members.manage   সদস্য ও আমন্ত্রণ কোড সামলানো
--   billing.manage   প্ল্যান ও বিলিং

delete from role_permissions;

-- মালিক — সব কিছু
insert into role_permissions (role, permission)
select 'owner', p from unnest(array[
  'records.read','sales.create','sales.cancel','due.collect','stock.write',
  'medicines.write','customers.write','expenses.write','cash.write',
  'reports.read','settings.write','members.manage','billing.manage'
]) as p;

-- ম্যানেজার — দোকানের সব কাজ ও রিপোর্ট, কিন্তু সদস্য বা বিলিং নয়
insert into role_permissions (role, permission)
select 'manager', p from unnest(array[
  'records.read','sales.create','sales.cancel','due.collect','stock.write',
  'medicines.write','customers.write','expenses.write','cash.write',
  'reports.read','settings.write'
]) as p;

-- ক্যাশিয়ার — বিক্রয়, বাকি আদায়, স্টক দেখা। মুনাফা বা বাতিল নয়।
insert into role_permissions (role, permission)
select 'cashier', p from unnest(array[
  'records.read','sales.create','due.collect','customers.write'
]) as p;

-- স্টক কর্মী — স্টক ও ওষুধ। টাকার হিসাব নয়।
insert into role_permissions (role, permission)
select 'inventory', p from unnest(array[
  'records.read','stock.write','medicines.write'
]) as p;

-- হিসাবরক্ষক — সব রিপোর্ট পড়া। কোনো রেকর্ড বদলানো নয়।
insert into role_permissions (role, permission)
select 'accountant', p from unnest(array[
  'records.read','reports.read'
]) as p;
