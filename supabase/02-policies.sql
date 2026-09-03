-- Friday Pharma — Row Level Security
--
-- এখানেই "কারো ডেটা কেউ দেখতে পারবে না" নিশ্চিত হয়।
-- নিয়ম ডেটাবেসে বসানো, অ্যাপে নয়। কেউ সরাসরি API-তে অন্য ফার্মেসির
-- id দিয়ে চাইলেও শূন্য সারি ফেরে — ভুল করে ফাঁস হওয়ার পথ নেই।
--
-- দুটি স্তর একসাথে কাজ করে:
--   ১. কোন দোকান  — pharmacy_id = auth_pharmacy_id()
--   ২. কী করার অধিকার — has_permission('...')
-- প্রথমটি ছাড়া দ্বিতীয়টির কোনো মানে নেই, তাই দুটোই প্রতিটি policy-তে থাকে।
--
-- একটি নিয়ম ভুললে চলবে না: একই টেবিলে একাধিক permissive policy থাকলে
-- PostgreSQL তাদের using **OR** করে, আর with check-ও আলাদাভাবে **OR** করে।
-- অর্থাৎ এক policy-র using-এ আটকে গেলেও অন্য policy-র শিথিল with check দিয়ে
-- সারি ঢুকে যেতে পারে। তাই প্রতিটি with check নিজে থেকেই সম্পূর্ণ —
-- দোকান ও অনুমতি দুটোই আবার যাচাই করে, using-এ আছে বলে বাদ দেওয়া হয় না।

-- ============================================================
-- সব টেবিলে RLS চালু
-- ============================================================
alter table pharmacies         enable row level security;
alter table memberships        enable row level security;
alter table role_permissions   enable row level security;
alter table invites            enable row level security;
alter table app_settings       enable row level security;
alter table medicines          enable row level security;
alter table batches            enable row level security;
alter table stock_entries      enable row level security;
alter table stock_movements    enable row level security;
alter table customers          enable row level security;
alter table customer_ledger    enable row level security;
alter table sales              enable row level security;
alter table sale_items         enable row level security;
alter table due_payments       enable row level security;
alter table expense_categories enable row level security;
alter table expenses           enable row level security;
alter table cash_sessions      enable row level security;
alter table stock_adjustments  enable row level security;
alter table sale_returns       enable row level security;
alter table sale_return_items  enable row level security;
alter table audit_logs         enable row level security;

-- মালিকের নিজের সার্ভিস-কি ছাড়া কেউ RLS এড়াতে পারবে না
alter table pharmacies         force row level security;
alter table memberships        force row level security;
alter table invites            force row level security;

-- ============================================================
-- ফার্মেসি
-- ============================================================

-- নিজের চালু ফার্মেসি দেখা যায়। সাথে সদ্য তৈরি করা কিন্তু এখনো কেউ
-- যোগ দেয়নি এমন ফার্মেসিও — নইলে সাইন আপের পর নিজের দোকানটিই দেখা যেত না।
create policy pharmacy_select on pharmacies
  for select using (
    id = auth_pharmacy_id()
    or is_member_of(id)
    or (created_by = auth.uid() and not pharmacy_has_members(id))
  );

-- নতুন ফার্মেসি যে কেউ খুলতে পারে (সাইন আপ), কিন্তু created_by নিজের হতেই হবে।
-- এই একটি শর্তের উপরেই প্রথম মালিকানা দাবির নিরাপত্তা দাঁড়িয়ে আছে।
create policy pharmacy_insert on pharmacies
  for insert with check (auth.uid() is not null and created_by = auth.uid());

-- দোকানের তথ্য বদলাতে settings.write, প্ল্যান বদলাতে মালিক
create policy pharmacy_update on pharmacies
  for update using (id = auth_pharmacy_id() and has_permission('settings.write'))
  with check (id = auth_pharmacy_id() and has_permission('settings.write'));

-- ============================================================
-- সদস্যপদ — F1 এখানেই বন্ধ হয়
-- ============================================================
--
-- আগের নিয়ম ছিল `with check (user_id = auth.uid())` — অর্থাৎ "তুমি কে"
-- যাচাই হতো, "কোন দোকানে ঢুকছ" হতো না। যার কোনো সদস্যপদ ছিল না, সে
-- যেকোনো pharmacy_id দিয়ে নিজেকে মালিক বানিয়ে ফেলতে পারত।
-- এখন সদস্যপদ তৈরির পথ ঠিক তিনটি, আর তিনটিরই শর্ত আছে।

-- নিজের সব সদস্যপদ দেখা যায় (দোকান বাছাইয়ের তালিকা),
-- আর সহকর্মীদের দেখা যায় members.manage থাকলে।
create policy membership_select on memberships
  for select using (
    user_id = auth.uid()
    or (pharmacy_id = auth_pharmacy_id() and has_permission('members.manage'))
  );

-- ১. প্রথম দাবি: যে ফার্মেসি নিজে তৈরি করেছেন এবং যেখানে এখনো কেউ নেই,
--    সেখানে নিজেকে মালিক হিসেবে বসানো যায়। অন্য কারো দোকানে নয়।
create policy membership_bootstrap_owner on memberships
  for insert with check (
    user_id = auth.uid()
    and role = 'owner'
    and can_bootstrap_owner(pharmacy_id)
  );

-- ২. সদস্য যোগ করা: চালু ফার্মেসিতে members.manage থাকলে।
--    মালিক বানাতে পারেন কেবল আরেকজন মালিক — ম্যানেজার নিজেকে উঁচুতে তুলতে পারবেন না।
create policy membership_admin_insert on memberships
  for insert with check (
    pharmacy_id = auth_pharmacy_id()
    and has_permission('members.manage')
    and (role <> 'owner' or is_owner())
  );

-- ৩. আমন্ত্রণ কোড দিয়ে যোগ দেওয়া — এখানে কোনো policy নেই।
--    সেটি redeem_invite() ফাংশনের কাজ, যেখানে ভূমিকা আমন্ত্রণ থেকেই আসে।

-- নিজের নাম ও ডিফল্ট দোকান বদলানো যায়; ভূমিকা নয়।
create policy membership_update_self on memberships
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = auth_role_in(pharmacy_id));

-- সদস্য সামলানোর অধিকার থাকলে ভূমিকা বদলানো যায় — মালিক বানানো ছাড়া।
--
-- মন দিন: with check-এ অনুমতিটি আবার লেখা হয়েছে, ইচ্ছাকৃতভাবে।
-- একাধিক permissive policy থাকলে PostgreSQL সবগুলোর with check **OR** করে।
-- এখানে অনুমতিটি বাদ দিলে ক্যাশিয়ার নিজের সারিতে membership_update_self-এর
-- using পেরিয়ে এই policy-র শিথিল with check দিয়ে নিজেকে ম্যানেজার বানিয়ে
-- ফেলতে পারতেন। প্রতিটি with check তাই নিজে থেকেই সম্পূর্ণ হতে হবে।
create policy membership_update_admin on memberships
  for update using (
    pharmacy_id = auth_pharmacy_id() and has_permission('members.manage')
  )
  with check (
    pharmacy_id = auth_pharmacy_id()
    and has_permission('members.manage')
    and (role <> 'owner' or is_owner())
  );

-- সদস্য সরানো যায়, নিজেকে নয় (দোকান মালিকহীন হয়ে যেত)।
create policy membership_delete_admin on memberships
  for delete using (
    pharmacy_id = auth_pharmacy_id()
    and has_permission('members.manage')
    and user_id <> auth.uid()
  );

-- নিজে বেরিয়ে যাওয়া যায়
create policy membership_leave on memberships
  for delete using (user_id = auth.uid());

-- ============================================================
-- ভূমিকা ও অনুমতির তালিকা — সবার জন্য পড়ার মতো, কারো জন্য লেখার নয়
-- ============================================================
-- এতে কোনো ফার্মেসির ডেটা নেই, তাই সব লগইন করা ব্যবহারকারী পড়তে পারেন।
create policy role_permissions_read on role_permissions
  for select using (auth.uid() is not null);

-- ============================================================
-- আমন্ত্রণ কোড — F5 এখানেই বন্ধ হয়
-- ============================================================
--
-- আগের নিয়ম ছিল `using (used_by is null and expires_at > now())` — কোনো
-- ফার্মেসির শর্ত ছাড়াই। ফলে যেকোনো লগইন করা ব্যবহারকারী সব দোকানের সব
-- চালু কোড তালিকা করে দেখতে পারতেন, আর সেই কোডে যোগ দিতে পারতেন।
--
-- এখন টেবিলটি কেবল নিজের দোকানের, আর সেখানেও members.manage লাগে।
-- যিনি এখনো সদস্য নন তিনি invite_preview() দিয়ে কোড যাচাই করবেন —
-- সেখানে সম্পূর্ণ কোড জানা বাধ্যতামূলক, তাই তালিকা করে দেখার পথ নেই।
create policy invite_manage on invites
  for all
  using (pharmacy_id = auth_pharmacy_id() and has_permission('members.manage'))
  with check (pharmacy_id = auth_pharmacy_id() and has_permission('members.manage'));

-- ============================================================
-- ব্যবসার টেবিল — দোকান + অনুমতি
-- ============================================================
-- প্রতিটি টেবিলে: নিজের ফার্মেসির সারি, আর সেই কাজের অনুমতি।
-- লেখার সময় pharmacy_id অন্য কিছু দিলে with check আটকে দেয়।
--
-- তৃতীয় কলামটি বাতিল করার অনুমতি: বাতিল মানে status বদলানো, অর্থাৎ update।
-- ক্যাশিয়ার বিক্রয় করতে পারেন কিন্তু বাতিল করতে পারেন না — পার্থক্যটা এখানেই।

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('medicines',          'medicines.write', 'medicines.write'),
      ('batches',            'stock.write',     'stock.write'),
      ('stock_entries',      'stock.write',     'sales.cancel'),
      ('customers',          'customers.write', 'customers.write'),
      ('customer_ledger',    'sales.create',    'sales.cancel'),
      ('sales',              'sales.create',    'sales.cancel'),
      ('sale_items',         'sales.create',    'sales.cancel'),
      ('due_payments',       'due.collect',     'sales.cancel'),
      ('expense_categories', 'expenses.write',  'expenses.write'),
      ('expenses',           'expenses.write',  'sales.cancel'),
      ('cash_sessions',      'cash.write',      'cash.write'),
      ('stock_adjustments',  'stock.write',     'sales.cancel'),
      ('sale_returns',       'sales.create',    'sales.cancel'),
      ('sale_return_items',  'sales.create',    'sales.cancel')
    ) as t(tbl, write_perm, update_perm)
  loop
    execute format($f$
      create policy %1$s_tenant_select on %1$s
        for select using (
          pharmacy_id = auth_pharmacy_id() and has_permission('records.read')
        );
      create policy %1$s_tenant_insert on %1$s
        for insert with check (
          pharmacy_id = auth_pharmacy_id() and has_permission(%2$L)
        );
      create policy %1$s_tenant_update on %1$s
        for update using (
          pharmacy_id = auth_pharmacy_id() and has_permission(%3$L)
        )
        with check (
          pharmacy_id = auth_pharmacy_id() and has_permission(%3$L)
        );
    $f$, r.tbl, r.write_perm, r.update_perm);
  end loop;
end $$;

-- আর্থিক রেকর্ড কখনো সত্যিই মুছে ফেলা যায় না — বাতিল করতে হয়।
-- তাই কোনো delete policy নেই; delete চেষ্টা করলে শূন্য সারি প্রভাবিত হয়।

-- ============================================================
-- স্টকের নড়াচড়া — পড়া ও লেখা যায়, বদলানো যায় না
-- ============================================================
-- P2b-তে তৈরি টেবিলটি অপরিবর্তিত। শুধু policy দুটি নতুন কাঠামোয় লেখা হলো:
-- আগের মতোই select আর insert ছাড়া কিছু নেই, তার সাথে এখন অনুমতির স্তর।
-- ইতিহাস একবার লেখা হলে আর বদলায় না (নিয়ম I7); ভুল হলে উল্টো চিহ্নের
-- নতুন সারি লেখা হয়। ডেটাবেসের trigger-ও একই কথা আলাদা করে নিশ্চিত করে।
create policy stock_movements_tenant_select on stock_movements
  for select using (
    pharmacy_id = auth_pharmacy_id() and has_permission('records.read')
  );
create policy stock_movements_tenant_insert on stock_movements
  for insert with check (
    pharmacy_id = auth_pharmacy_id() and has_permission('stock.write')
  );

-- ============================================================
-- অডিট লগ — যে কোনো সদস্য লেখেন, কেউ বদলাতে পারেন না
-- ============================================================
create policy audit_logs_tenant_select on audit_logs
  for select using (
    pharmacy_id = auth_pharmacy_id() and has_permission('records.read')
  );
create policy audit_logs_tenant_insert on audit_logs
  for insert with check (
    pharmacy_id = auth_pharmacy_id() and has_permission('records.read')
  );

-- ============================================================
-- সেটিংস — দেখা সবাই, বদলানো settings.write
-- ============================================================
create policy settings_select on app_settings
  for select using (
    pharmacy_id = auth_pharmacy_id() and has_permission('records.read')
  );
create policy settings_insert on app_settings
  for insert with check (
    pharmacy_id = auth_pharmacy_id() and has_permission('settings.write')
  );
create policy settings_update on app_settings
  for update using (
    pharmacy_id = auth_pharmacy_id() and has_permission('settings.write')
  )
  with check (
    pharmacy_id = auth_pharmacy_id() and has_permission('settings.write')
  );
