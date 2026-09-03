-- Friday Pharma — Row Level Security
--
-- এখানেই "কারো ডেটা কেউ দেখতে পারবে না" নিশ্চিত হয়।
-- নিয়ম ডেটাবেসে বসানো, অ্যাপে নয়। কেউ সরাসরি API-তে অন্য ফার্মেসির
-- id দিয়ে চাইলেও শূন্য সারি ফেরে — ভুল করে ফাঁস হওয়ার পথ নেই।

-- ============================================================
-- সব টেবিলে RLS চালু
-- ============================================================
alter table pharmacies         enable row level security;
alter table profiles           enable row level security;
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
alter table profiles           force row level security;

-- ============================================================
-- ফার্মেসি
-- ============================================================

-- নিজের ফার্মেসিটিই কেবল দেখা যায়
create policy pharmacy_select on pharmacies
  for select using (id = auth_pharmacy_id());

-- নতুন ফার্মেসি যে কেউ খুলতে পারে (সাইন আপ), কিন্তু তারপর profiles-এ
-- যুক্ত না হলে আর দেখতেও পাবে না।
create policy pharmacy_insert on pharmacies
  for insert with check (auth.uid() is not null);

-- শুধু মালিক নিজের ফার্মেসির তথ্য বদলাতে পারেন
create policy pharmacy_update on pharmacies
  for update using (id = auth_pharmacy_id() and is_owner())
  with check (id = auth_pharmacy_id());

-- ============================================================
-- ব্যবহারকারী
-- ============================================================

-- একই ফার্মেসির সদস্যরা একে অপরকে দেখতে পান
create policy profile_select on profiles
  for select using (pharmacy_id = auth_pharmacy_id() or user_id = auth.uid());

-- নিজের প্রোফাইল নিজেই তৈরি করেন (সাইন আপ বা আমন্ত্রণ গ্রহণ)
create policy profile_insert on profiles
  for insert with check (user_id = auth.uid());

-- নিজের নাম বদলানো যায়; ভূমিকা বদলাতে পারেন কেবল মালিক
create policy profile_update_self on profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and role = (select role from profiles p where p.user_id = auth.uid()));

create policy profile_update_owner on profiles
  for update using (pharmacy_id = auth_pharmacy_id() and is_owner())
  with check (pharmacy_id = auth_pharmacy_id());

-- মালিক কর্মচারী সরাতে পারেন, নিজেকে নয়
create policy profile_delete_owner on profiles
  for delete using (pharmacy_id = auth_pharmacy_id() and is_owner() and user_id <> auth.uid());

-- ============================================================
-- আমন্ত্রণ কোড
-- ============================================================
create policy invite_owner_all on invites
  for all using (pharmacy_id = auth_pharmacy_id() and is_owner())
  with check (pharmacy_id = auth_pharmacy_id() and is_owner());

-- কোড হাতে থাকলে সেটি যাচাই করা যায় (যোগ দেওয়ার সময়)
create policy invite_lookup on invites
  for select using (used_by is null and expires_at > now());

-- ============================================================
-- ব্যবসার টেবিল — সবগুলোর নিয়ম এক
-- ============================================================
-- প্রতিটি টেবিলে: শুধু নিজের ফার্মেসির সারি পড়া, লেখা ও বদলানো যায়।
-- লেখার সময় pharmacy_id অন্য কিছু দিলে with check আটকে দেয়।

do $$
declare t text;
begin
  foreach t in array array[
    'medicines','batches','stock_entries','customers','customer_ledger',
    'sales','sale_items','due_payments','expense_categories','expenses',
    'cash_sessions','stock_adjustments','sale_returns','sale_return_items','audit_logs'
  ]
  loop
    execute format($f$
      create policy %1$s_tenant_select on %1$s
        for select using (pharmacy_id = auth_pharmacy_id());
      create policy %1$s_tenant_insert on %1$s
        for insert with check (pharmacy_id = auth_pharmacy_id());
      create policy %1$s_tenant_update on %1$s
        for update using (pharmacy_id = auth_pharmacy_id())
        with check (pharmacy_id = auth_pharmacy_id());
    $f$, t);
  end loop;
end $$;

-- ============================================================
-- স্টকের নড়াচড়া — পড়া ও লেখা যায়, বদলানো যায় না
-- ============================================================
-- উপরের লুপে এটিকে রাখা হয়নি, কারণ লুপ update policy-ও বানায়।
-- এখানে ইচ্ছে করেই select আর insert ছাড়া কিছু নেই: নড়াচড়ার ইতিহাস
-- একবার লেখা হলে আর বদলায় না (নিয়ম I7)। ভুল হলে উল্টো চিহ্নের নতুন
-- সারি লেখা হয়। ডেটাবেসের trigger-ও একই কথা আলাদা করে নিশ্চিত করে।
create policy stock_movements_tenant_select on stock_movements
  for select using (pharmacy_id = auth_pharmacy_id());
create policy stock_movements_tenant_insert on stock_movements
  for insert with check (pharmacy_id = auth_pharmacy_id());

-- আর্থিক রেকর্ড কখনো সত্যিই মুছে ফেলা যায় না — বাতিল করতে হয়।
-- তাই কোনো delete policy নেই; delete চেষ্টা করলে শূন্য সারি প্রভাবিত হয়।

-- সেটিংস শুধু মালিকের
create policy settings_select on app_settings
  for select using (pharmacy_id = auth_pharmacy_id());
create policy settings_insert on app_settings
  for insert with check (pharmacy_id = auth_pharmacy_id() and is_owner());
create policy settings_update on app_settings
  for update using (pharmacy_id = auth_pharmacy_id() and is_owner())
  with check (pharmacy_id = auth_pharmacy_id());
