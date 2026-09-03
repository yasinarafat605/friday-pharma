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
create type member_role as enum ('owner', 'staff');

create table pharmacies (
  id            uuid primary key,               -- ডিভাইসে তৈরি হওয়া id-ই ব্যবহার হয়
  name          text not null check (length(btrim(name)) > 0),
  owner_name    text,
  phone         text,
  address       text,
  plan          plan_tier not null default 'trial',
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  is_active     boolean not null default true,  -- বকেয়া বিল বা বন্ধ অ্যাকাউন্ট
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role        member_role not null default 'staff',
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on profiles (pharmacy_id);

-- কর্মচারী যোগ করার আমন্ত্রণ কোড
create table invites (
  code        text primary key,
  pharmacy_id uuid not null references pharmacies(id) on delete cascade,
  role        member_role not null default 'staff',
  expires_at  timestamptz not null default (now() + interval '7 days'),
  used_by     uuid references auth.users(id),
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on invites (pharmacy_id);

-- ============================================================
-- কে কোন ফার্মেসির — RLS-এর ভিত্তি
-- ============================================================

-- SECURITY DEFINER, তাই profiles-এর নিজের RLS-এ আটকে গিয়ে চক্র তৈরি হয় না।
create or replace function auth_pharmacy_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pharmacy_id from profiles where user_id = auth.uid()
$$;

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'owner' from profiles where user_id = auth.uid()), false)
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
