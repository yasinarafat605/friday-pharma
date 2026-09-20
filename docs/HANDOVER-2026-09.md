# Handover — September 2026

For an agent with no prior context. Everything below was verified against the
repo on 2026-09-03 at commit `8da3e98`, not recalled. Full detail lives in
[`docs/PHASE-HANDOFF.md`](PHASE-HANDOFF.md) — read it before changing anything.

---

## 1. What this is

Friday Pharma: an offline-first pharmacy management app for Bangladesh (Bangla
UI, money as integer paisa), shipped as a Next.js 14 static export — PWA plus a
Capacitor 6 Android APK from one codebase. All data lives locally in IndexedDB
via Dexie 4 (database `asshifa_local`, schema v4).

It is being converted into a multi-pharmacy SaaS. **No Supabase project has ever
been created** — the SQL has still never been applied anywhere. But `src/` is no
longer Supabase-free: `@supabase/supabase-js` is a dependency (`package.json`),
and the client lives in `src/lib/supabase/` (`client.ts`, `auth.ts`,
`AuthContext.tsx`) as of P4. The app still runs 100% locally when the two
`NEXT_PUBLIC_SUPABASE_*` variables are unset, which is the supported default.

---

## 2. Current state

| Phase | Commit | Date | What it did |
|---|---|---|---|
| P1 | `8a198f8` | 2026-08-29 | Sync foundation: `dirty` flag stops the echo loop, pure stamping rules, migration checkpoints |
| P2 | `3aba084` | 2026-08-29 | Append-only `stock_movements` ledger + backfill, replacing a mutable counter |
| Branding | `a913948` | 2026-09-02 | Logo redrawn as vectors, icons, `BrandMark.tsx` |
| P2b | `361d3d1` | 2026-09-03 | `qty_in_stock` becomes a maintained cache; server `stock_movements` table |
| P3 | `36fa13f` | 2026-09-03 | `profiles` → `memberships`, 5 roles, `role_permissions` + `has_permission()`, validating resolver; closed F1 and F5 |
| P3a | `8da3e98` | 2026-09-03 | R8 (loud missing seed) and R9 (cost columns protected); housekeeping |

Supporting commits: `a3669b6` (P2 invariants spec), `b379caf` (P2 docs + P3
plan), `c2de1dd` (original handoff note), `ff172eb` (rebrand + tenant fields).

### P4 — Authentication: DONE (P4 server + client, P4b app wiring)

Delivered, not planned. Each row below is implemented; see `docs/TESTING-P4B.md`
for how to exercise it by hand.

| Must do | Where it landed |
|---|---|
| Wire Supabase Auth | `src/lib/supabase/client.ts`, `auth.ts`, `AuthContext.tsx` |
| Sign-up: create pharmacy **then** bootstrap owner membership, in that order | The membership insert depends on `pharmacies.created_by` from step one |
| Sign-in: pick an active pharmacy for multi-membership users and send it as the claim `auth_pharmacy_id()` reads (request header or JWT claim) | The resolver already validates whatever arrives; it returns null on an unmatched claim |
| Joining a shop calls `redeem_invite(code)` — never a direct membership insert | The role comes from the invite, not the joiner |
| Keep the 8-digit PIN as a screen lock, not the account key | Unchanged; `src/lib/auth.ts` only gained SSR guards |

P4b additionally closed the app-side gaps P4 left: the invite journey is now
reachable end to end (preview → sign in → confirm → active pharmacy), the
pharmacy switcher in `AppShell` routes through `switchActivePharmacy()`,
`leavePharmacy()` is wired to a Settings card, and a misconfigured deploy now
fails loudly instead of building a client against a dummy URL and key.

Still unstarted: the sync engine (push/pull), an in-app screen for *creating*
invite codes (they must be inserted by hand for now), any permission admin UI,
and paid plans.

---

## 3. Risk register

Severity: **C**ritical / **H**igh / **M**edium / **L**ow.

### Resolved

| ID | Description | Sev | Resolved in | Was blocking |
|---|---|---|---|---|
| 1 | Stock reads scanned the whole movement table on every screen load | H | P2b `361d3d1` | Performance at scale |
| 2 | Server had no `stock_movements` table; sync would drop every movement | H | P2b `361d3d1` | Sync engine |
| F1 | Any authenticated user could insert themselves as owner of any `pharmacy_id` | **C** | P3 `36fa13f` | Any live deployment |
| F5 | Invite codes readable across every tenant; anyone could enumerate and join | M | P3 `36fa13f` | Any live deployment |
| R8 | Missing permission seed made the app silently read-only, no diagnostic | H | P3a `8da3e98` | Ops / deploys |
| R9 | Cost columns readable by roles denied `reports.read` (margin leak) | H | P3a `8da3e98` | Staff-facing release |

### Open

| ID | Description | Sev | Blocks |
|---|---|---|---|
| 3 | Backfill cannot be re-run; no supported path to rebuild the movement log | H | Nothing now; hit by any restore (see F2) |
| 4 | Dual write (movement + `qty_in_stock`) enforced only by a manual browser test | M | Any `data.ts` change is unguarded |
| 5 | `ref_type` + `ref_id` is not unique — one source record can emit several movements | L | Any future "one movement per record" logic |
| 6 | Reconstruction ordering is approximate; the negative-dip check is a heuristic | L | Nothing |
| F2 | Backup/restore silently drops the entire stock ledger (`ALL_TABLES` omits `stock_movements`) | H | Real multi-device use |
| F3 | Backfilled movement ids are `mv-<type>-<id>`, not UUIDs; server column is `uuid` | H | Sync engine — every backfilled row fails to push |
| F4 | `markSynced()` uses `table.update()`, which the append-only hook rejects on `stock_movements` | M | Sync engine push |
| F6 | Soft-delete filtering inconsistent: several report/dashboard reads filter on `status` only, not `deleted_at` | M | Sync engine (remote tombstones would be counted) |
| F7 | `deleteBatch()` changes visible stock with no movement written | L | Ledger completeness |
| F8 | Dead code and no lint gate (no ESLint config; `next build` skips linting) | L | Nothing |
| R7 | Nothing stops the last owner leaving via `membership_leave`, orphaning the pharmacy | M | P4 / member admin UI |
| R10 | `invite_preview()` is unthrottled; only code length makes guessing impractical | M | P4 invite flow |
| R11 | `is_default` is not enforced to exist; multi-membership user with no default resolves to null and sees nothing | M | P4 sign-in |
| R12 | `has_permission()` does an extra existence check per call, inside policies, per row | L | Only if policy evaluation gets slow |
| R13 | Allowed-column grant list in `04-column-security.sql` is manual; a new column is unreadable until added | L | Schema changes to 3 tables |
| R14 | **Sync engine cannot `select *`** on `sale_items` / `batches` / `stock_entries` | H | Sync engine design |
| R15 | `v_*_costs` views carry their own tenant predicate; no RLS behind them | **C if broken** | Any edit to those views |
| R16 | A missing seed now breaks reads too — health checks must not query a business table | L | Health-check design |
| R17 | No in-app screen creates invite codes. A shop owner cannot invite anyone without someone inserting a row into `invites` by hand in the SQL editor. `redeem_invite()` and `invite_preview()` both work; only the issuing end is missing | H | Any real employee onboarding |
| R18 | The role→Bangla label map is duplicated three times: `getRoleBadge()` in `AppShell.tsx`, `ROLE_BN` in `login/page.tsx`, `ROLE_BN` in `settings/page.tsx`. A sixth role, or a wording change, must be made in three files | L | Nothing now; a silent inconsistency later |
| R19 | `isSupabaseConfigured returns a boolean` in `auth-p4.test.ts` still asserts only the return *type*, which a `!!(...)` expression can never violate. Kept because P4b was told not to delete existing tests; it should be replaced, not removed | L | False confidence in the suite count |
| R20 | The offline PIN path could not be verified in a browser. Under headless Chrome with `--virtual-time-budget`, `ensureSeeded()` never resolves and the login page stays on "লোড হচ্ছে…", so only the pre-seed render was confirmed. Needs one manual pass in a real browser, per `docs/TESTING-P4B.md` ভাগ ১ | M | Confidence in the offline first-run journey |

### ⚠ Where these are actually recorded — discrepancies found

Verified by grep, not assumed:

| Item | Reality |
|---|---|
| Risks 1–6 | In `docs/PHASE-HANDOFF.md`, numbered plainly `1.`–`6.`, **not** `R1`–`R6`. The `R1`–`R6` labels themselves **do** exist, in `docs/audit/2026-09-03-pre-p3-audit.html` (Section 1, "Consolidated risk register"), which maps them onto those same six. |
| F1, F5, R8, R9, R12–R16 | In `docs/PHASE-HANDOFF.md` risk section ✅ |
| F2, F3, F6, F7, F8 | **Not in `PHASE-HANDOFF.md`.** Only in `docs/audit/2026-09-03-pre-p3-audit.html` |
| F4 | Described in `PHASE-HANDOFF.md` (P2b section, "Known gap this exposes for the sync engine") but **not labelled F4** |
| **R7, R10, R11** | **All three are implemented in `supabase/05-auth.sql`** (added 2026-09-04): §১ R7 — `before delete` trigger blocking the last owner; §২ R10 — `invite_preview()` rebuilt with throttling; §৩ R11 — triggers guaranteeing exactly one default pharmacy. Regression-tested by isolation groups `১১ R7`, `১২ R10` and `১৩ R11`. |

There is no `R1`–`R6` identifier in `docs/PHASE-HANDOFF.md`, which numbers those six
risks plainly `1.`–`6.`. They are labelled `R1`–`R6` in exactly one place:
`docs/audit/2026-09-03-pre-p3-audit.html`, whose Section 1 register carries rows
`R1` through `R6` and cross-references each back to "handoff §Risks 1"–"6".
If you renumber, do it once and update `PHASE-HANDOFF.md` in the same commit.

---

## 4. The two things most likely to get silently broken

### 4.1 `v_*_costs` views carry their own tenant predicate

`supabase/04-column-security.sql` defines `v_batch_costs`,
`v_stock_entry_costs` and `v_sale_item_costs`. All three are
`with (security_invoker = off)` — **definer rights** — because the caller has no
privilege on the cost column at all. Definer rights mean **RLS on the base table
is bypassed**. Each view therefore carries its own tenant filter:

```sql
where b.pharmacy_id  = auth_pharmacy_id()   -- line 81
where e.pharmacy_id  = auth_pharmacy_id()   -- line 99
where si.pharmacy_id = auth_pharmacy_id()   -- line 117
  and has_permission('reports.read')
```

Delete or weaken any of those lines and it is an immediate cross-tenant leak
with **nothing behind it to catch the mistake**. It looks like a redundant
`where` clause. It is not. The isolation suite has cases for exactly this
(group `৯ R9`); they are the only thing standing between an edit and a leak.

### 4.2 R14 — the sync engine cannot `select *`

These three tables have had table-level `select` revoked from `authenticated`,
with the allowed columns granted back by name:

| Table | Hidden column |
|---|---|
| `batches` | `purchase_price_paisa` |
| `stock_entries` | `purchase_price_paisa` |
| `sale_items` | `cost_price_paisa` |

A `select *` on any of them returns `ERROR: permission denied for table <t>`,
even for an owner. A sync pull must:

1. select the **permitted projection** by column name, and
2. read cost through `v_batch_costs` / `v_stock_entry_costs` /
   `v_sale_item_costs` for roles that hold `reports.read` — and pull no cost at
   all for roles that do not, which is the intended behaviour, not a bug.

Related: `04-column-security.sql` **must run last**. A table-level grant (which
Supabase issues automatically on new tables) silently undoes the column revoke.

---

## 5. Verifying project health

Run all three. Any deviation from the expected numbers is a red flag, not noise.

Last verified 2026-09-20 against the 2026-09-04 SQL, including `05-auth.sql`:
**133 of 133 isolation cases pass, zero failures, on PostgreSQL 16.**

| # | Command | Expected | Notes |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | exit 0, **no output** | `strict: true`; no `noUnusedLocals` |
| 2 | `npx vitest run` | **8 files, 128 passed, 0 failed** | pure logic only |
| 3 | `bash supabase/run-isolation-test.sh` | **133 passed, 0 failed** | needs real PostgreSQL |

Per-file test counts (a change here without a matching commit is suspicious):

```
stock-reconstruct 33   sync-stamp 17   scan-parse 21   business-rules 11
dates 9   backup-status 8   money 5   auth-p4 24            total 128
```

Isolation suite groups — expected pass counts:

```
১ মূল 9    ২ F1 9     ৩ F5 8      ৪ resolver 11   ৫ owner 4
৫ manager 6   ৫ cashier 8   ৫ inventory 6   ৫ accountant 7
৬ escalation 5   ৭ removal 6   ৮ movements 6   ৯ R9 21   ১০ R8 10
১১ R7 4   ১২ R10 7   ১৩ R11 6
                                                    total 133
```

On success it also prints, from the SQL itself:

```
NOTICE: অনুমতি বসানো হয়েছে — 33 টি সারি, 5 টি ভূমিকা
NOTICE: ক্রয়মূল্যের তিনটি কলাম সুরক্ষিত; পড়ার পথ v_*_costs view
NOTICE: সব ঠিক আছে — 133 টি ক্ষেত্রেই পাস
```

The script creates a scratch database, applies `00`→`05`, runs the suite, raises
on any failure and drops the database. It **never touches a live project**.
`PGHOST`/`PGPORT`/`PGUSER` default to `/tmp` / `5433` / `postgres`. `initdb`
refuses to run as root — run it as the `postgres` user.

**Not runnable:** `next build` needs `next/font/google`, so it fails without
network access to Google Fonts. Stub the `Noto_Sans_Bengali` import in a
throwaway copy if you need a build check. There is **no lint gate** (F8).

---

## 6. `git status`

The snapshot below was taken on 2026-09-03 at `8da3e98`, before P4 and P4b
existed:

```
$ git rev-parse --abbrev-ref HEAD
master
$ git rev-parse HEAD
8da3e986111ef21015e37645aeac39760a0f7985
$ git status --porcelain
$
```

**That snapshot is historical, not current.** It was already wrong by
2026-09-04, when the P4 work was written and left uncommitted for sixteen days.
P4 is committed as of `5b85a77`, and P4b on top of it; `master` now tracks
`origin/master` on GitHub. Do not trust this block — run `git status` and
`git log --oneline -5` yourself, which is the only current answer.

One thing exists on disk but is deliberately ignored:

| Path | State |
|---|---|
| `Claude outputs/audit-report.html` | Untracked, matched by `.gitignore:37` (`/Claude outputs/`). A copy is versioned at `docs/audit/2026-09-03-pre-p3-audit.html`. Safe to delete. |

Also ignored and expected: `node_modules/`, `.next/`, `out/`,
`tsconfig.tsbuildinfo`, `next-env.d.ts`.

---

## 7. If you read only this

**Safe to build on.** All three health checks pass at `8da3e98`, the working
tree is clean, and the two critical findings from the pre-P3 audit (F1 tenant
takeover, F5 invite enumeration) are closed and regression-tested. The
membership and permission model is finished and proven against real PostgreSQL,
so P4 (authentication) has a solid base — start there, and start with sign-up,
because the bootstrap-owner path is the one piece of the model no UI exercises
yet. **What is not safe** is the sync engine: F2, F3, F4, F6 and R14 are all
open and all bite the moment rows move between devices, so do not start sync
without reading them first. **Never touch `supabase/0*.sql` — any policy, grant,
helper function or view — without re-running `bash
supabase/run-isolation-test.sh` and confirming 133/133.** Two edits in
particular are silent killers: removing a `pharmacy_id = auth_pharmacy_id()`
line from a `v_*_costs` view (§4.1), and writing a policy whose `with check`
leans on its own `using` clause — PostgreSQL ORs the `with check` of every
permissive policy on a table, and that already produced a live privilege
escalation once during P3. Nothing here has been applied to a live Supabase
project, which is the only reason all of this is still cheap to change.
