-- Friday Pharma — পর্ব ৪: প্রমাণীকরণ ও সদস্যপদ দৃঢ়করণ (P4 Auth & RBAC Hardening)
--
-- এই ফাইলে রয়েছে:
--   ১. R7  — শেষ মালিক দোকান ত্যাগ করতে পারবেন না (orphaning প্রতিরোধ)
--   ২. R10 — invite_preview() brute-force রোধে throttling / rate-limiting
--   ৩. R11 — প্রতিটি ব্যবহারকারীর ঠিক একটি ডিফল্ট ফার্মেসি নিশ্চিতকরণ
--   ৪. PostgREST রিকোয়েস্ট হেডার (x-pharmacy-id) থেকে সক্রিয় দোকান দাবি পড়া
--
-- মন দিন: 01-schema.sql, 02-policies.sql, 03-permissions.sql, 04-column-security.sql
-- সম্পূর্ণ অপরিবর্তিত রাখা হয়েছে। নতুন সব সংযোজন এখানে।

-- ============================================================
-- ১. R7: শেষ মালিক প্রস্থান প্রতিরোধ (Last-Owner Orphaning)
-- ============================================================
-- কোনো ফার্মেসির শেষ সক্রিয় মালিক যদি membership_leave বা অন্য উপায়ে
-- সদস্যপদ মুছে ফেলতে চান, তা ডেটাবেস স্তরেই আটকে দেওয়া হয়।

create or replace function trg_memberships_prevent_last_owner_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners integer;
begin
  if OLD.role = 'owner' then
    -- দোকানটি যদি এখনো pharmacies টেবিলে থাকে (অর্থাৎ পুরো দোকান মোছা হচ্ছে না)
    if exists (select 1 from pharmacies where id = OLD.pharmacy_id) then
      select count(*) into remaining_owners
        from memberships
       where pharmacy_id = OLD.pharmacy_id
         and role = 'owner'
         and user_id <> OLD.user_id;

      if remaining_owners = 0 then
        raise exception 'দোকানের শেষ মালিক সদস্যপদ ত্যাগ করতে পারবেন না'
          using errcode = 'check_violation',
                hint = 'অন্য কাউকে মালিক বানিয়ে তারপর প্রস্থান করুন';
      end if;
    end if;
  end if;
  return OLD;
end;
$$;

drop trigger if exists memberships_prevent_last_owner_leave on memberships;
create trigger memberships_prevent_last_owner_leave
  before delete on memberships
  for each row
  execute function trg_memberships_prevent_last_owner_leave();


-- ============================================================
-- ২. R10: invite_preview() Throttling / Rate-Limiting
-- ============================================================
-- অনুমানযোগ্য বা ছোট কোড brute-force করে সব চালু আমন্ত্রণ খুঁজে বের করার চেষ্টা রোধ।
-- প্রতি আইডেন্টিফায়ার (লগইন ব্যবহারকারী, আইপি বা ক্লায়েন্ট আইডি)-এ ১৫ মিনিটে
-- সর্বোচ্চ ৫টি ব্যর্থ চেষ্টার পর কোড যাচাই সাময়িকভাবে বন্ধ থাকে।

create table if not exists invite_preview_attempts (
  id           bigserial primary key,
  identifier   text not null,
  attempted_at timestamptz not null default now(),
  success      boolean not null default false
);

create index if not exists idx_invite_preview_attempts_id_time
  on invite_preview_attempts (identifier, attempted_at desc);

alter table invite_preview_attempts enable row level security;

-- নিশ্চিত করা যে anon ভূমিকা রয়েছে (Supabase-এ থাকে, স্থানীয় পরীক্ষায় নাও থাকতে পারে)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

-- সরাসরি টেবিলে সাধারণ ব্যবহারকারীর পড়ার দরকার নেই — ফাংশন security definer
grant select, insert on invite_preview_attempts to authenticated, anon;
grant usage, select on sequence invite_preview_attempts_id_seq to authenticated, anon;

create or replace function invite_preview(p_code text)
returns table (pharmacy_id uuid, pharmacy_name text, role member_role)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  client_id text;
  failed_attempts integer;
  found_row record;
begin
  -- আইডেন্টিফায়ার নির্ধারণ: টেস্টের GUC, লগইন ইউজার, অথবা রিকোয়েস্ট হেডার
  client_id := coalesce(
    nullif(current_setting('app.client_id', true), ''),
    auth.uid()::text,
    nullif((current_setting('request.headers', true)::json)->>'x-forwarded-for', ''),
    nullif((current_setting('request.headers', true)::json)->>'cf-connecting-ip', ''),
    'anonymous-client'
  );

  -- পুরোনো রেকর্ড পরিষ্কার (১ ঘণ্টার পুরোনো) — হালকা রাখার জন্য
  delete from invite_preview_attempts
   where attempted_at < now() - interval '1 hour';

  -- গত ১৫ মিনিটে ব্যর্থ চেষ্টা কতগুলো
  select count(*) into failed_attempts
    from invite_preview_attempts
   where identifier = client_id
     and not success
     and attempted_at > now() - interval '15 minutes';

  if failed_attempts >= 5 then
    raise exception 'অতিরিক্ত ভুল কোড চেষ্টা করা হয়েছে — ১৫ মিনিট পর আবার চেষ্টা করুন'
      using errcode = 'P0001',
            hint = 'বারবার ভুল কোড দেওয়ার কারণে সাময়িকভাবে কোড যাচাই বন্ধ আছে';
  end if;

  -- কোড অনুসন্ধান
  select i.pharmacy_id, ph.name, i.role into found_row
    from invites i
    join pharmacies ph on ph.id = i.pharmacy_id
   where i.code = p_code
     and i.used_by is null
     and i.expires_at > now();

  if found_row is not null then
    -- সফল চেষ্টা লগ করা
    insert into invite_preview_attempts (identifier, success)
    values (client_id, true);

    pharmacy_id   := found_row.pharmacy_id;
    pharmacy_name := found_row.name;
    role          := found_row.role;
    return next;
  else
    -- ব্যর্থ চেষ্টা লগ করা
    insert into invite_preview_attempts (identifier, success)
    values (client_id, false);
    return;
  end if;
end;
$$;

grant execute on function invite_preview(text) to authenticated, anon;


-- ============================================================
-- ৩. R11: নিশ্চিত ডিফল্ট ফার্মেসি (Guaranteed Default Pharmacy)
-- ============================================================
-- একজন ব্যবহারকারীর অন্তত একটি সদস্যপদ থাকলে অবশ্যই ঠিক একটি memberships
-- সারিতে is_default = true থাকবে। ফলে কোনো দাবি ছাড়া প্রবেশ করলেও
-- auth_pharmacy_id() কখনোই নিঃশব্দে null হবে না।

create or replace function trg_memberships_ensure_default_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_default boolean;
begin
  -- ট্রিগার পুনরাবৃত্তি (recursion) রোধ
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    select exists (
      select 1 from memberships
       where user_id = NEW.user_id and is_default = true
    ) into has_default;

    if not has_default then
      NEW.is_default := true;
    elsif NEW.is_default then
      -- নতুন সারিকে ডিফল্ট করলে আগের ডিফল্টটি তুলে দেওয়া
      update memberships
         set is_default = false
       where user_id = NEW.user_id and is_default = true;
    end if;
    return NEW;

  elsif TG_OP = 'UPDATE' then
    if NEW.is_default and not OLD.is_default then
      -- অন্য দোকানের ডিফল্ট তুলে দেওয়া
      update memberships
         set is_default = false
       where user_id = NEW.user_id
         and pharmacy_id <> NEW.pharmacy_id
         and is_default = true;
    elsif not NEW.is_default and OLD.is_default then
      -- নিজের একমাত্র ডিফল্ট নিজে নিজে মিথ্যা করা নিষিদ্ধ যদি অন্য কোনো ডিফল্ট না থাকে
      if not exists (select 1 from memberships where user_id = NEW.user_id and pharmacy_id <> NEW.pharmacy_id and is_default = true) then
        NEW.is_default := true;
      end if;
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

create or replace function trg_memberships_ensure_default_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return OLD;
  end if;

  if OLD.is_default then
    -- ডিফল্ট দোকানটি মুছে গেলে অবশিষ্ট দোকানের মধ্যে সবচেয়ে পুরোনোটিকে ডিফল্ট বানানো
    update memberships
       set is_default = true
     where user_id = OLD.user_id
       and pharmacy_id = (
         select pharmacy_id from memberships
          where user_id = OLD.user_id
          order by joined_at asc limit 1
       );
  end if;
  return OLD;
end;
$$;

drop trigger if exists memberships_ensure_default_before on memberships;
create trigger memberships_ensure_default_before
  before insert or update of is_default on memberships
  for each row
  execute function trg_memberships_ensure_default_before();

drop trigger if exists memberships_ensure_default_after_delete on memberships;
create trigger memberships_ensure_default_after_delete
  after delete on memberships
  for each row
  execute function trg_memberships_ensure_default_after_delete();


-- ============================================================
-- ৪. PostgREST হেডার (x-pharmacy-id) থেকে সক্রিয় দাবি পড়া
-- ============================================================
-- Supabase-এ ক্লায়েন্ট x-pharmacy-id হেডার পাঠালে তা PostgREST স্বয়ংক্রিয়ভাবে
-- request.headers GUC-তে রূপান্তর করে। টেস্টের জন্য app.active_pharmacy অগ্রাধিকার পায়।

create or replace function active_pharmacy_claim()
returns uuid
language plpgsql
stable
as $$
declare
  raw_claim text;
  headers json;
  claims json;
begin
  -- ১. সরাসরি সেশন সেটিং (টেস্ট ও স্ক্রিপ্টের জন্য)
  raw_claim := nullif(current_setting('app.active_pharmacy', true), '');

  -- ২. PostgREST request.headers থেকে x-pharmacy-id হেডার
  if raw_claim is null then
    begin
      headers := current_setting('request.headers', true)::json;
      raw_claim := nullif(headers->>'x-pharmacy-id', '');
    exception when others then
      raw_claim := null;
    end;
  end if;

  -- ৩. PostgREST JWT claims থেকে active_pharmacy
  if raw_claim is null then
    begin
      claims := current_setting('request.jwt.claims', true)::json;
      raw_claim := nullif(claims->>'active_pharmacy', '');
    exception when others then
      raw_claim := null;
    end;
  end if;

  return raw_claim::uuid;
exception when others then
  return null;
end;
$$;

create or replace function has_active_pharmacy_claim()
returns boolean
language plpgsql
stable
as $$
declare
  raw_claim text;
  headers json;
  claims json;
begin
  raw_claim := nullif(current_setting('app.active_pharmacy', true), '');
  if raw_claim is not null then return true; end if;

  begin
    headers := current_setting('request.headers', true)::json;
    if nullif(headers->>'x-pharmacy-id', '') is not null then return true; end if;
  exception when others then
  end;

  begin
    claims := current_setting('request.jwt.claims', true)::json;
    if nullif(claims->>'active_pharmacy', '') is not null then return true; end if;
  exception when others then
  end;

  return false;
end;
$$;

grant execute on function active_pharmacy_claim() to authenticated, anon;
grant execute on function has_active_pharmacy_claim() to authenticated, anon;
