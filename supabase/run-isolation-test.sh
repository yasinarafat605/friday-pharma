#!/usr/bin/env bash
# Friday Pharma — বিচ্ছিন্নতার পরীক্ষা চালানোর স্ক্রিপ্ট
#
#   bash supabase/run-isolation-test.sh
#
# একটি খালি ডেটাবেস বানিয়ে schema, policy, permission আর পরীক্ষা চালায়,
# তারপর ডেটাবেসটি মুছে ফেলে। কোনো live প্রজেক্ট ছোঁয় না।
#
# policy বা helper ফাংশন বদলালেই এটি চালান। একটিও ক্ষেত্র ব্যর্থ হলে
# exit code শূন্য নয়, তাই CI-তেও বসানো যায়।
#
# পরিবেশের চলক (সব ঐচ্ছিক):
#   PGHOST PGPORT PGUSER   — ডিফল্ট: /tmp 5433 postgres
#   TESTDB                 — ডিফল্ট: fp_isolation_test

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
TESTDB="${TESTDB:-fp_isolation_test}"

if ! pg_isready -q; then
  echo "PostgreSQL চলছে না ($PGHOST:$PGPORT)।" >&2
  echo "মনে রাখুন: initdb root হিসেবে চলে না — postgres ব্যবহারকারী হিসেবে চালান।" >&2
  exit 2
fi

echo "ডেটাবেস তৈরি: $TESTDB"
psql -q -c "drop database if exists $TESTDB;" >/dev/null
psql -q -c "create database $TESTDB;" >/dev/null

run() { psql -q -v ON_ERROR_STOP=1 -d "$TESTDB" -f "$1"; }

run "$HERE/00-test-harness.sql"
run "$HERE/01-schema.sql"
run "$HERE/02-policies.sql"
run "$HERE/03-permissions.sql"

# অনুমতি: Supabase-এ এটি স্বয়ংক্রিয়, স্থানীয় পরীক্ষায় হাতে দিতে হয়।
# মন দিন — এটি 04-column-security.sql-এর **আগে** চলে, ঠিক যেমন Supabase-এ
# নতুন টেবিলে grant বসে। টেবিল-স্তরের grant কলামের revoke মুছে দেয়,
# তাই 04 সবার শেষে।
psql -q -v ON_ERROR_STOP=1 -d "$TESTDB" <<'SQL' >/dev/null
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema auth to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema auth to authenticated;
SQL

# সবার শেষে — টেবিল-স্তরের grant কলামের revoke মুছে দেয়, তাই এটিই ক্রম
run "$HERE/04-column-security.sql"

status=0
psql -v ON_ERROR_STOP=1 -d "$TESTDB" -f "$HERE/test-isolation.sql" || status=$?

psql -q -c "drop database if exists $TESTDB;" >/dev/null

if [ "$status" -ne 0 ]; then
  echo "বিচ্ছিন্নতার পরীক্ষা ব্যর্থ।" >&2
  exit "$status"
fi
echo "বিচ্ছিন্নতার পরীক্ষা সফল।"
