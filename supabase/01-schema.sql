-- Friday Pharma — বহু-ফার্মেসি ডেটাবেস (Supabase / PostgreSQL)
--
-- মূল নিয়ম: প্রতিটি সারিতে pharmacy_id থাকে, আর Row Level Security
-- ডেটাবেস স্তরেই ঠিক করে দেয় কে কোন সারি দেখতে পাবে। অ্যাপে ভুল থাকলেও
-- এক ফার্মেসির ডেটা অন্য ফার্মেসি টেনে আনতে পারবে না।
--
-- সব টাকা integer paisa (bigint)। সব id uuid, ক্লায়েন্টেই তৈরি হয়,
-- তাই অফলাইনে বানানো রেকর্ড পরে হুবহু একই id নিয়ে সার্ভারে ওঠে।

create extension if not exists "pgcrypto";

-- ============================================================
-- ফার্মেসি ও ব্যবহারকারী
-- ============================================================

create type plan_tier as enum ('trial', 'free', 'pro');
-- পাঁচটি ভূমিকা। কে কী পারবে তা এখানে নয়, role_permissions টেবিলে —
-- নতুন ভূমিকা যোগ করা মানে কয়েকটি সারি, policy আবার লেখা নয়।
create type member_role as enum
  ('owner', 'manager', 'cashier', 'inventory', 'accountant');

create table pharmacies (
  id            uuid primary key,               -- ডিভাইসে তৈরি হওয়া id-ই ব্যবহার হয়
  name          text not null check (length(btrim(name)) > 0),
  owner_name    text,
  phone         text,
  address       text,
  plan          plan_tier not null default 'trial',
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  is_active     boolean not null default true,  -- বকেয়া বিল বা বন্ধ অ্যাকাউন্ট
  -- কে এটি তৈরি করেছে। প্রথম মালিকানা দাবির একমাত্র ভিত্তি এটাই —
  -- এটি ছাড়া যে কেউ যেকোনো pharmacy_id দিয়ে নিজেকে মালিক বানাতে পারত।
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- এক ব্যক্তি একাধিক ফার্মেসিতে থাকতে পারেন — তাই জোড়াটিই primary key।
-- আগে user_id একাই key ছিল, অর্থাৎ একজন চিরকাল একটি দোকানেই আটকে থাকতেন।
create table memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role        member_role not null default 'cashier',
  -- একাধিক দোকানে থাকলে কোনটি আগে খুলবে
  is_default  boolean not null default false,
  full_name   text,
  phone       text,
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, pharmacy_id)
);
create index on memberships (pharmacy_id);
-- একজনের একটিই ডিফল্ট
create unique index memberships_one_default on memberships (user_id) where is_default;

-- ভূমিকা → অনুমতি। Policy আর ভূমিকার নাম দেখে না, এই তালিকা দেখে।
-- সারিগুলো 03-permissions.sql-এ।
create table role_permissions (
  role       member_role not null,
  permission text not null,
  primary key (role, permission)
);

-- কর্মচারী যোগ করার আমন্ত্রণ কোড
create table invites (
  code        text primary key,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role        member_role not null default 'cashier',
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_by     uuid references auth.users(id),
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on invites (pharmacy_id);

-- ============================================================
-- কে কোন ফার্মেসির — RLS-এর ভিত্তি
-- ============================================================
--
-- নিচের সব ফাংশন SECURITY DEFINER। তাই এগুলো memberships পড়ার সময়
-- memberships-এর নিজের RLS-এ আটকায় না, আর policy → policy চক্রও হয় না।

-- ক্লায়েন্ট কোন ফার্মেসিতে কাজ করতে চাইছে বলে *দাবি* করছে।
-- এটি নিছক দাবি — কখনো সরাসরি ব্যবহার করা হয় না, সবসময় যাচাই হয়।
-- Supabase-এ এটি request header বা JWT claim থেকে আসবে; পরীক্ষায় GUC থেকে।
create or replace function has_active_pharmacy_claim()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.active_pharmacy', true), ''), '') <> ''
$$;

-- দাবিটি uuid হিসেবে পড়া গেল কিনা। না গেলে null, কিন্তু "দাবি নেই" নয় —
-- পার্থক্যটা জরুরি: আজেবাজে দাবি দিয়ে ডিফল্ট দোকানে গড়িয়ে যাওয়া চলবে না।
create or replace function active_pharmacy_claim()
returns uuid
language plpgsql
stable
as $$
begin
  return nullif(current_setting('app.active_pharmacy', true), '')::uuid;
exception when others then
  return null;
end;
$$;

/*
 * এই মুহূর্তে ব্যবহারকারী কোন ফার্মেসিতে আছেন।
 *
 * ১. দাবি থাকলে — সদস্যপদ থাকলে তবেই সেটি ফেরে।
 * ২. দাবি থাকলে কিন্তু সদস্যপদ না থাকলে **null**, অন্য কিছুতে গড়িয়ে যায় না।
 *    গড়িয়ে গেলে ভুল দাবি নিঃশব্দে অন্য দোকানে কাজ করত।
 * ৩. দাবি না থাকলে — ডিফল্ট, নইলে একমাত্র সদস্যপদ।
 * ৪. কিছুই না মিললে null, আর null মানে RLS-এ সর্বত্র শূন্য সারি।
 */
create or replace function auth_pharmacy_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claim uuid := active_pharmacy_claim();
  found_id uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  -- দাবি করা হয়েছে (তা পড়া যাক বা না যাক) — তাহলে সেটিই একমাত্র পথ।
  if has_active_pharmacy_claim() then
    if claim is null then
      return null;                        -- অপাঠ্য দাবি = অবৈধ দাবি
    end if;
    select m.pharmacy_id into found_id
      from memberships m
     where m.user_id = auth.uid() and m.pharmacy_id = claim;
    return found_id;                      -- সদস্য না হলে null। ইচ্ছাকৃত।
  end if;

  select m.pharmacy_id into found_id
    from memberships m
   where m.user_id = auth.uid() and m.is_default;
  if found_id is not null then
    return found_id;
  end if;

  select m.pharmacy_id into found_id
    from memberships m
   where m.user_id = auth.uid()
   limit 2;                               -- একটির বেশি থাকলে বেছে নেওয়া যাবে না
  if (select count(*) from memberships m where m.user_id = auth.uid()) = 1 then
    return found_id;
  end if;

  return null;
end;
$$;

-- চালু ফার্মেসিতে ব্যবহারকারীর ভূমিকা
create or replace function auth_role()
returns member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from memberships m
   where m.user_id = auth.uid() and m.pharmacy_id = auth_pharmacy_id()
$$;

/*
 * অনুমতি আছে কিনা — ভূমিকার নাম নয়, তালিকা দেখে।
 * Policy-তে 'sales.cancel' লেখা থাকে; কোন ভূমিকা সেটি পায় তা
 * role_permissions-এর সারি বদলেই পাল্টানো যায়।
 */
create or replace function has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from memberships m
      join role_permissions rp on rp.role = m.role
     where m.user_id = auth.uid()
       and m.pharmacy_id = auth_pharmacy_id()
       and rp.permission = perm
  )
$$;

-- বিলিং ও মালিকানার জন্য — বাকি সব জায়গায় has_permission ব্যবহার করুন
create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth_role() = 'owner', false)
$$;

-- নির্দিষ্ট ফার্মেসিতে ব্যবহারকারীর ভূমিকা। নিজের ভূমিকা নিজে বদলানো
-- আটকাতে policy-তে এটি লাগে (একই টেবিলে subquery দিলে RLS-এ চক্র হতো)।
create or replace function auth_role_in(p uuid)
returns member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from memberships m
   where m.user_id = auth.uid() and m.pharmacy_id = p
$$;

-- নির্দিষ্ট ফার্মেসিতে সদস্য কিনা (চালু ফার্মেসি নয়, যেকোনোটি)
create or replace function is_member_of(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
     where m.user_id = auth.uid() and m.pharmacy_id = p
  )
$$;

-- ফার্মেসিতে আদৌ কোনো সদস্য আছে কিনা। দাবিহীন (unclaimed) ফার্মেসি চেনার জন্য।
create or replace function pharmacy_has_members(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from memberships m where m.pharmacy_id = p)
$$;

/*
 * প্রথম মালিকানা দাবি করা যাবে কিনা — F1 এর মূল প্রতিরোধ।
 *
 * দুটি শর্ত একসাথে: ফার্মেসিটি এই ব্যবহারকারীই তৈরি করেছেন, এবং সেখানে
 * এখনো কেউ নেই। তাই অন্যের pharmacy_id জানা থাকলেও নিজেকে মালিক বসানো যায় না।
 */
create or replace function can_bootstrap_owner(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1 from pharmacies ph
        where ph.id = p and ph.created_by = auth.uid()
     )
     and not exists (select 1 from memberships m where m.pharmacy_id = p)
$$;

-- ফার্মেসির সাবস্ক্রিপশন চালু আছে কিনা (পেইড প্ল্যানের জন্য প্রস্তুত)
create or replace function pharmacy_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.is_active and (p.plan <> 'trial' or p.trial_ends_at > now())
    from pharmacies p where p.id = auth_pharmacy_id()
  ), false)
$$;

-- ============================================================
-- আমন্ত্রণ কোড — টেবিল পড়ে নয়, ফাংশন দিয়ে
-- ============================================================
--
-- invites টেবিলের select policy কেবল নিজের ফার্মেসির সারি দেখায় (F5)।
-- যিনি এখনো সদস্য নন তিনি কোড যাচাই করবেন নিচের ফাংশন দিয়ে — সেখানে
-- সম্পূর্ণ কোডটি জানা বাধ্যতামূলক, তাই তালিকা করে দেখার (enumerate) পথ নেই।
-- কোড অবশ্যই যথেষ্ট এলোমেলো হতে হবে; ছোট বা অনুমানযোগ্য কোড এই সুরক্ষা নষ্ট করে।

create or replace function invite_preview(p_code text)
returns table (pharmacy_id uuid, pharmacy_name text, role member_role)
language sql
stable
security definer
set search_path = public
as $$
  select i.pharmacy_id, ph.name, i.role
    from invites i
    join pharmacies ph on ph.id = i.pharmacy_id
   where i.code = p_code
     and i.used_by is null
     and i.expires_at > now()
$$;

-- কোড ব্যবহার করে যোগ দেওয়া। ভূমিকা আমন্ত্রণ থেকেই আসে, ব্যবহারকারীর
-- পছন্দ থেকে নয় — তাই কেউ নিজেকে মালিক বলে ঢুকতে পারে না।
create or replace function redeem_invite(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  inv invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'লগইন ছাড়া যোগ দেওয়া যাবে না';
  end if;

  select * into inv from invites
   where code = p_code and used_by is null and expires_at > now()
   for update;

  if not found then
    raise exception 'আমন্ত্রণ কোডটি ভুল বা মেয়াদ শেষ';
  end if;

  insert into memberships (user_id, pharmacy_id, role)
  values (auth.uid(), inv.pharmacy_id, inv.role)
  on conflict (user_id, pharmacy_id) do nothing;

  update invites set used_by = auth.uid(), used_at = now() where code = p_code;
  return inv.pharmacy_id;
end;
$$;

-- ============================================================
-- ব্যবসার টেবিল — সবগুলোতে pharmacy_id
-- ============================================================

create table app_settings (
  pharmacy_id         uuid primary key references pharmacies(id) on delete cascade,
  pharmacy_name       text not null default '',
  owner_name          text,
  phone               text,
  address             text,
  currency            text not null default 'BDT',
  locale              text not null default 'bn',
  auto_lock_minutes   int  not null default 3,
  low_stock_syrup     int  not null default 1,
  low_stock_tablet    int  not null default 10,
  low_stock_capsule   int  not null default 10,
  expiry_alert_days   int  not null default 90,
  last_backup_at      timestamptz,
  backup_reminder_days int not null default 7,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create table medicines (
  id                  uuid primary key,
  pharmacy_id         uuid not null references pharmacies(id) on delete cascade,
  name                text not null,
  bn_name             text,
  strength            text,
  generic_name        text,
  company             text,
  type                text not null,
  unit                text not null,
  low_stock_threshold int,
  note                text,
  is_active           boolean not null default true,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (pharmacy_id, id)
);
create index on medicines (pharmacy_id, updated_at);

create table batches (
  id                   uuid primary key,
  pharmacy_id          uuid not null references pharmacies(id) on delete cascade,
  medicine_id          uuid not null,
  batch_no             text,
  expiry_date          date,
  purchase_price_paisa bigint not null default 0 check (purchase_price_paisa >= 0),
  sale_price_paisa     bigint not null default 0 check (sale_price_paisa >= 0),
  qty_in_stock         numeric not null default 0,
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index on batches (pharmacy_id, updated_at);

create table stock_entries (
  id                   uuid primary key,
  pharmacy_id          uuid not null references pharmacies(id) on delete cascade,
  client_txn_id        text not null,
  batch_id             uuid not null,
  qty                  numeric not null,
  purchase_price_paisa bigint not null default 0,
  sale_price_paisa     bigint not null default 0,
  entry_date           date not null,
  invoice_no           text,
  note                 text,
  status               text not null default 'completed',
  cancelled_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  unique (pharmacy_id, client_txn_id)          -- একই লেনদেন দুবার উঠবে না
);
create index on stock_entries (pharmacy_id, updated_at);

-- ------------------------------------------------------------
-- স্টকের নড়াচড়া — শুধু যোগ হয়, কখনো বদলায় না, কখনো মোছে না
-- ------------------------------------------------------------
-- ডিভাইসের `stock_movements` টেবিলের হুবহু প্রতিরূপ (src/types/db.ts →
-- StockMovement)। এটি না থাকলে সিঙ্ক প্রতিটি নড়াচড়া নিঃশব্দে ফেলে দিত।
--
-- batches.qty_in_stock হলো দ্রুত পড়ার জন্য রাখা **হিসাব করা সংখ্যা**।
-- সত্যিকারের ইতিহাস এই টেবিলে। মিল না থাকলে এখান থেকেই আবার গোনা হয়।
--
-- reason-এর তালিকা src/types/db.ts-এর MovementReason-এর সাথে এক রাখতে হবে।
create table stock_movements (
  id            uuid primary key,
  pharmacy_id   uuid not null references pharmacies(id) on delete cascade,
  batch_id      uuid not null,
  medicine_id   uuid not null,
  qty_delta     numeric not null,               -- বিক্রয়ে ঋণাত্মক, ক্রয়ে ধনাত্মক
  reason        text not null check (reason in (
                  'opening_balance','purchase','sale','adjustment',
                  'return','write_off','reversal')),
  ref_type      text,                           -- 'sale_item', 'stock_entry', ...
  ref_id        uuid,
  business_date date not null,                  -- স্থানীয় দিনপঞ্জি, রিপোর্টের জন্য
  created_at    timestamptz not null default now(),
  client_txn_id text not null,
  note          text,
  updated_at    timestamptz not null default now(),
  -- অন্য টেবিলের সাথে মিল রাখতে রাখা হয়েছে; append-only বলে সবসময় null
  deleted_at    timestamptz,
  unique (pharmacy_id, client_txn_id)           -- একই নড়াচড়া দুবার উঠবে না
);
create index on stock_movements (pharmacy_id, updated_at);
create index on stock_movements (pharmacy_id, batch_id);
create index on stock_movements (pharmacy_id, business_date);

-- ডেটাবেসই বদল ও মোছা আটকায় (ডিভাইসে Dexie hook যা করে, তারই জোড়া)।
-- RLS-এ update বা delete policy নেই, তবু service key দিয়েও যেন ভুল করে
-- ইতিহাস বদলে না যায়। সত্যিই দরকার হলে trigger সাময়িক বন্ধ করতে হবে —
-- অর্থাৎ কাজটি ইচ্ছাকৃত ও দৃশ্যমান।
create or replace function stock_movements_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements append-only: উল্টো চিহ্নের নতুন সারি লিখুন';
end;
$$;

create trigger stock_movements_no_update
  before update on stock_movements
  for each row execute function stock_movements_append_only();

create trigger stock_movements_no_delete
  before delete on stock_movements
  for each row execute function stock_movements_append_only();

create table customers (
  id                uuid primary key,
  pharmacy_id       uuid not null references pharmacies(id) on delete cascade,
  name              text not null,
  phone             text,
  village           text,
  photo_url         text,
  note              text,
  first_due_date    date,
  last_txn_date     date,
  current_due_paisa bigint not null default 0,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index on customers (pharmacy_id, updated_at);

create table customer_ledger (
  id             uuid primary key,
  pharmacy_id    uuid not null references pharmacies(id) on delete cascade,
  customer_id    uuid not null,
  entry_type     text not null,
  amount_paisa   bigint not null,
  ref_sale_id    uuid,
  ref_payment_id uuid,
  ref_return_id  uuid,
  note           text,
  entry_date     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index on customer_ledger (pharmacy_id, updated_at);

create table sales (
  id               uuid primary key,
  pharmacy_id      uuid not null references pharmacies(id) on delete cascade,
  client_txn_id    text not null,
  txn_no           text not null,
  sale_date        timestamptz not null default now(),
  customer_id      uuid,
  subtotal_paisa   bigint not null default 0,
  discount_paisa   bigint not null default 0,
  total_paisa      bigint not null default 0,
  payment_type     text not null,
  cash_paid_paisa  bigint not null default 0,
  due_paisa        bigint not null default 0,
  status           text not null default 'completed',
  cancelled_reason text,
  note             text,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (pharmacy_id, client_txn_id),
  unique (pharmacy_id, txn_no)
);
create index on sales (pharmacy_id, updated_at);

create table sale_items (
  id               uuid primary key,
  pharmacy_id      uuid not null references pharmacies(id) on delete cascade,
  sale_id          uuid not null,
  medicine_id      uuid not null,
  batch_id         uuid not null,
  qty              numeric not null,
  unit_price_paisa bigint not null default 0,
  cost_price_paisa bigint not null default 0,
  line_total_paisa bigint not null default 0,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on sale_items (pharmacy_id, updated_at);

create table due_payments (
  id            uuid primary key,
  pharmacy_id   uuid not null references pharmacies(id) on delete cascade,
  client_txn_id text not null,
  receipt_ref   text not null,
  customer_id   uuid not null,
  pay_date      date not null,
  amount_paisa  bigint not null check (amount_paisa > 0),
  method        text not null,
  status        text not null default 'completed',
  note          text,
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (pharmacy_id, client_txn_id)
);
create index on due_payments (pharmacy_id, updated_at);

create table expense_categories (
  id           uuid primary key,
  pharmacy_id  uuid not null references pharmacies(id) on delete cascade,
  name         text not null,
  bn_name      text not null,
  is_recurring boolean not null default false,
  sort_order   int not null default 50,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on expense_categories (pharmacy_id, updated_at);

create table expenses (
  id             uuid primary key,
  pharmacy_id    uuid not null references pharmacies(id) on delete cascade,
  client_txn_id  text not null,
  expense_date   date not null,
  category_id    uuid not null,
  amount_paisa   bigint not null check (amount_paisa > 0),
  description    text,
  receipt_url    text,
  payment_source text not null default 'cash',
  status         text not null default 'completed',
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (pharmacy_id, client_txn_id)
);
create index on expenses (pharmacy_id, updated_at);

create table cash_sessions (
  id                    uuid primary key,
  pharmacy_id           uuid not null references pharmacies(id) on delete cascade,
  session_date          date not null,
  opening_cash_paisa    bigint not null default 0,
  actual_closing_paisa  bigint,
  note                  text,
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (pharmacy_id, session_date)
);
create index on cash_sessions (pharmacy_id, updated_at);

create table stock_adjustments (
  id               uuid primary key,
  pharmacy_id      uuid not null references pharmacies(id) on delete cascade,
  client_txn_id    text not null,
  batch_id         uuid not null,
  qty              numeric not null,
  reason           text not null,
  note             text,
  adjusted_at      timestamptz not null default now(),
  status           text not null default 'completed',
  cancelled_reason text,
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (pharmacy_id, client_txn_id)
);
create index on stock_adjustments (pharmacy_id, updated_at);

create table sale_returns (
  id               uuid primary key,
  pharmacy_id      uuid not null references pharmacies(id) on delete cascade,
  client_txn_id    text not null,
  sale_id          uuid not null,
  return_date      date not null,
  refund_paisa     bigint not null default 0,
  reason           text not null,
  status           text not null default 'completed',
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (pharmacy_id, client_txn_id)
);
create index on sale_returns (pharmacy_id, updated_at);

create table sale_return_items (
  id           uuid primary key,
  pharmacy_id  uuid not null references pharmacies(id) on delete cascade,
  return_id    uuid not null,
  sale_item_id uuid not null,
  batch_id     uuid not null,
  qty          numeric not null,
  restock      boolean not null default false,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index on sale_return_items (pharmacy_id, updated_at);

create table audit_logs (
  id          uuid primary key,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  entity      text not null,
  entity_id   text not null,
  action      text not null,
  old_value   jsonb,
  new_value   jsonb,
  device      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index on audit_logs (pharmacy_id, updated_at);
