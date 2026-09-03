-- Friday Pharma — পরীক্ষার জন্য auth স্তরের নকল
--
-- এটি **কেবল পরীক্ষার** ফাইল। Supabase-এ auth schema, auth.users আর
-- auth.uid() আগে থেকেই থাকে, তাই সেখানে এটি চালানোর দরকার নেই — চালালে
-- ক্ষতিও হতে পারে। শুধু স্থানীয় PostgreSQL-এ test-isolation.sql চালানোর
-- আগে ব্যবহার করুন।
--
-- আসল Supabase-এ auth.uid() JWT থেকে আসে। এখানে একটি GUC থেকে আসে,
-- যাতে এক সেশনেই বিভিন্ন ব্যবহারকারী সেজে পরীক্ষা করা যায়।

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language plpgsql
stable
as $$
begin
  return nullif(current_setting('app.uid', true), '')::uuid;
exception when others then
  return null;
end;
$$;

-- Supabase-এর লগইন করা ব্যবহারকারীর ভূমিকা
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
