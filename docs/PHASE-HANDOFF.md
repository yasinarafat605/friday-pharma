# Friday Pharma Development Handoff

> Read this before changing anything. It exists so a new session can pick up
> the work without re-deriving decisions that were already made deliberately.
>
> Last updated after P3. Next work item is authentication (Supabase Auth).

---

## Project Goal

**Original app.** A single-owner pharmacy management app for a small village
pharmacy in Bangladesh, originally named আশ শিফা ফার্মেসী. Fully offline: sales,
stock, customer credit (বাকি), expenses, cash reconciliation and reports, with
no server, no accounts and no internet requirement. All data lived in the
browser's IndexedDB on one device. The interface is Bangla throughout and all
money is stored as integer paisa, never floats.

**Where it is going.** The product is being converted into **Friday Pharma**, a
multi-pharmacy SaaS platform. Many pharmacies, each with its own account, its
own staff and data that no other pharmacy can reach. Paid plans are planned
later (trial / free / pro columns already exist in the server schema).

**Architecture.** Offline-first, not online-only. This is the product's main
advantage in this market, where most competitors stop working when the
connection drops. Every write lands in local IndexedDB first and syncs to
Supabase (PostgreSQL) when the network allows. Selling medicine must never
depend on the server being reachable.

The app ships as a Next.js 14 static export (`output: 'export'`), delivered
both as a PWA and as a Capacitor 6 Android APK from one codebase.

---

## Completed Phases

### Phase 1 — Multi-tenant Foundation
**Status: Completed** (commit `ff172eb`)

- **`pharmacy_id`** — added to every business record. Generated on the device
  and stored in `localStorage` under `fp_pharmacy_id`. The server will reuse
  this exact id as the pharmacy's primary key when the account is created, so
  existing local records join the owner's account with no conversion step.
- **`updated_at`** — added to every record. Set automatically. See the P1
  section below for the critical correction to how it is applied.
- **`deleted_at`** — soft delete. Deleting marks the row instead of removing
  it, so the deletion itself can travel to other devices later. Every read
  filters deleted rows out (`isLive`, `liveArray` in `src/lib/data.ts`).
- **`client_txn_id`** — already existed on all six transactional tables from
  the original design. Paired with `unique (pharmacy_id, client_txn_id)` on
  the server so a re-pushed transaction is a no-op rather than a duplicate.
- **Supabase schema and RLS** — written in `supabase/01-schema.sql` and
  `supabase/02-policies.sql`. 19 tables, 16 policies. **Not yet applied to any
  live Supabase project.**
- **Security verification.** Real PostgreSQL 16 was installed and the schema
  and policies applied against an `auth` schema stub, with two pharmacies and
  three users. Results: each owner sees only their own rows; requesting the
  other pharmacy's rows by id returns zero rows rather than an error; writing
  into another pharmacy is rejected; moving a row to another pharmacy is
  rejected; deleting a financial record affects zero rows because no delete
  policy exists; staff can read their shop but cannot change settings or the
  plan; an unauthenticated caller sees nothing. Re-run this whenever policies
  change. Note `initdb` refuses to run as root — run it as the `postgres` user.

### Phase 2 Preparation — P1 Sync Foundation
**Status: Completed** (commit `8a198f8`)

**Files changed**

| File | Change |
|---|---|
| `src/lib/db/local.ts` | Schema v3; hooks now delegate to pure stamping functions |
| `src/types/db.ts` | `dirty` added to `SyncFields`; new `SyncState`, `SyncFailure` types |
| `src/lib/db/stamp.ts` | **New.** The stamping rules as pure functions |
| `src/lib/db/checkpoint.ts` | **New.** Migration snapshot mechanism |
| `src/lib/sync/state.ts` | **New.** Sync cursors, failure records, retry timing |
| `src/lib/__tests__/sync-stamp.test.ts` | **New.** 17 tests |
| `.gitignore` | Stopped tracking `tsconfig.tsbuildinfo` |

**Files intentionally NOT changed** — `src/lib/data.ts` (that is P2),
`supabase/01-schema.sql` and `supabase/02-policies.sql` (that is P3), and every
page component. Keeping P1 isolated is what makes it independently revertible.

**Why the `dirty` flag was introduced.** The push selector cannot be a
timestamp comparison. The `updating` hook previously restamped `updated_at` on
every write with no exception, so a row pulled from the server immediately
looked locally edited and would be pushed straight back, bumped by the server,
pulled again — an infinite echo loop that worsens with every device added.

A classic outbox table was considered and rejected: an outbox row and its
business row must be written in one transaction or they drift, and Dexie
requires each transaction to declare its tables up front, which would have
meant widening all fifteen existing transactions and remembering to do so in
every future one. A flag on the row itself is stamped by the hook that already
runs, so it cannot be forgotten.

A module-level "currently applying remote data" flag was also considered and
rejected: the app is fully async, so a flag set around one `await` can leak
into an unrelated interleaved write. Intent passed in the write itself cannot.

**Why `stamp.ts` was created.** The stamping rules are the single most
important logic in the sync design, and Dexie hooks cannot be unit tested in
Node without IndexedDB. Extracting the rules into pure functions
(`stampCreate`, `stampUpdate`) means they are tested directly rather than
trusted, and the hooks became two thin call sites.

**The rule, in one line:** an explicitly supplied value always wins. Ordinary
app writes supply nothing and get stamped `dirty = 1` with a fresh timestamp.
The sync engine supplies `dirty: 0` and the server's timestamp, and is left
alone.

**Checkpoint system design.** Schema upgrades write a full snapshot into a
`_checkpoints` store **inside the same database, in the same transaction** as
the change, so the copy and the change commit or roll back together. Writing to
a separate database was rejected because the upgrade transaction can commit
before a cross-database write finishes, leaving a partial snapshot. The last
three checkpoints are kept (`selectCheckpointsToPrune`), and
`verifyCheckpoint` confirms stored row counts match the stored rows.

This is **not** a replacement for the encrypted backup export, which is the
off-device copy. If the database itself is lost, the checkpoints go with it.

**IndexedDB v3 migration behaviour.** The upgrade takes a checkpoint, then
marks every existing row `dirty = 1`. That is correct because no row has ever
reached a server, and it doubles as the mechanism for adopting existing local
data at first sign-in — no separate migration is needed at signup.

Note: the upgrade's `modify()` call causes the `updating` hook to restamp
`updated_at` on existing rows. This is harmless and was accepted deliberately —
`updated_at` is sync metadata and is used by no report or business rule.

**Rollback limitations.** IndexedDB schema versions only go forward. Once the
v3 upgrade has run on a device, opening that database with v2 code throws
rather than falling back. **A rollback therefore reverts behaviour, never the
version declaration.** Keep `this.version(3)` in place and revert the logic;
the extra stores sit unused and harmless.

**Verification performed.** 71 tests pass (17 new), lint clean, production
build clean. Migration was proved against a seeded v2 database: all rows and
`pharmacy_id` values preserved, all rows marked for first push, and the
checkpoint verified row by row as a faithful pre-migration copy. The echo loop
was proved fixed end to end in a browser — a simulated pull of ten server rows
selects **zero** rows for push, where before it would have selected all ten.

### P2 — Immutable Stock Movements
**Status: Completed** (commit `3aba084`)

**Files changed**

| File | Change |
|---|---|
| `src/lib/stock/reconstruct.ts` | **New.** Pure replay logic, no database |
| `src/lib/stock/backfill.ts` | **New.** Migration, depends only on the pure logic |
| `src/lib/stock/movements.ts` | **New.** Database-facing helpers and the integrity check |
| `src/lib/__tests__/stock-reconstruct.test.ts` | **New.** 26 tests |
| `src/types/db.ts` | `StockMovement`, `MovementReason` |
| `src/lib/db/local.ts` | Schema v4, append-only guard |
| `src/lib/data.ts` | Nine movement writes, nine widened transaction scopes, stock reads switched |
| `src/lib/sync/state.ts` | `stock_movements` added to the sync list |
| `src/app/(app)/settings/page.tsx` | The integrity check as a user action |

**The architecture.** `batches.qty_in_stock` used to be a mutable counter written
by nine code paths, each reading a number and writing an absolute value back.
Two devices selling offline both wrote absolutes, and last-write-wins on sync
silently lost one sale with no error. Stock is now an append-only
`stock_movements` log; movements never overwrite each other, so they merge.

Each movement carries `batch_id`, `medicine_id`, a signed `qty_delta`, a
`reason`, a `ref_type`/`ref_id` pointing at the record that caused it, a local
`business_date` and a `client_txn_id`. Reasons are `opening_balance`,
`purchase`, `sale`, `adjustment`, `return`, `write_off` and `reversal`.

**The backfill** replays only records that are still active. Cancellations were
originally applied by editing the counter rather than writing a reversing row,
so replaying everything would double-count. Any remaining difference becomes an
explicit `opening_balance` movement, so no displayed stock figure moved.

**Two cross-checks, and why the second exists.** The first check summed the
generated movements and compared them to the counter. During verification this
turned out to be insufficient: the opening balance is computed as
*counter minus replay*, so a reconstruction bug would have been absorbed by
that balancing row and the totals would still have agreed. The check would have
passed on broken data. The replay is therefore computed a **second time by
deliberately different code** (`independentReplay` in `backfill.ts`) and the two
are compared. A disagreement throws, Dexie aborts the entire upgrade, and the
database stays at v3 with the counter in charge.

`independentReplay` must stay deliberately different from `reconstructMovements`.
Refactoring them to share code destroys the entire point of the check.

**Append-only is enforced, not intended.** Hooks on `stock_movements` throw on
update and delete. Corrections write an opposite movement.

**Rollback.** `STOCK_SOURCE` in `data.ts` flips stock reads back to the counter
in one word. The counter is still written at every site and is still correct.

**Verified** against a seeded database containing a cancelled sale, a cancelled
stock entry, a cancelled adjustment and two returns with one cancelled. All
eight invariants in `docs/P2-INVARIANTS.md` passed. 97 tests, lint and build
clean.

---

## Current Database State

- **IndexedDB database name:** `asshifa_local` — **deliberately unchanged**
  through the rebrand. Renaming it would orphan every record on every existing
  device.
- **Current Dexie schema version: 4** (IndexedDB reports this as `40`).
  Versions 1, 2 and 3 remain declared in `local.ts` and must stay there so
  devices on older versions can upgrade through them in order.
- **Stores added in v3:** `sync_state`, `sync_failures`, `_checkpoints`.
- **Store added in v4:** `stock_movements`, append-only.
- **Field added in v3:** `dirty` on the synced stores, indexed.
- **Synced stores (15):** medicines, batches, stock_entries, customers,
  customer_ledger, sales, sale_items, due_payments, expense_categories,
  expenses, cash_sessions, stock_adjustments, sale_returns, sale_return_items,
  stock_movements. `settings` and `audit_logs` are **not** stamped — this is
  finding P5 in the audit and still needs a deliberate decision.
- **`SYNCED_TABLES_V3` is frozen.** The v3 upgrade iterates it, and a device
  still on v2 will run that upgrade. Adding a later store to it would make that
  upgrade fail looking for a store that does not yet exist. Add new synced
  stores to `SYNCED_TABLES` only.
- **Migration behaviour:** additive only. No store dropped, no field removed,
  no row deleted, at any version.
- **Existing data safety:** the database name, all `localStorage` PIN keys and
  every existing row are untouched by P1. The app behaves identically before
  and after the upgrade.

---

## Important Engineering Decisions

These are not preferences. Changing any of them reintroduces a bug that was
already diagnosed and fixed.

1. **`updated_at` alone is NOT a sync trigger.** Never select rows to push by
   comparing timestamps. That is what caused the echo loop.
2. **The `dirty` flag controls local push eligibility.** `dirty = 1` means the
   row has local changes not yet on the server. It is the only push selector.
3. **Server pulls must never create dirty records.** Any write applying server
   data must pass `dirty: 0` and the server's `updated_at` explicitly. The
   stamping rules respect explicit values precisely so this is possible.
4. **Financial records remain immutable.** Sales, payments, expenses, returns,
   adjustments and stock entries are never edited after creation. Corrections
   are made by cancelling (`status: 'cancelled'`) and writing a reversal.
   Status only ever moves completed → cancelled, never back, so it merges
   safely across devices. This is already implemented throughout `data.ts`.
5. **Stock lives in `stock_movements`, and that log is append-only.** Done in
   P2. Never edit or delete a movement; write an opposite one. Never remove
   `qty_in_stock` — it is the rollback path and is heading towards being a
   maintained cache. And never refactor `independentReplay` to share code with
   `reconstructMovements`: being written differently is the whole point of the
   cross-check that guards the migration.
6. **Never delete existing user data during migrations.** Every migration is
   additive, takes a checkpoint first, and verifies before committing. If a
   migration cannot reconcile, it must abort rather than half-apply.

---

## Current Status

**Completed**

- ✅ Multi-tenant foundation (`pharmacy_id`, `updated_at`, `deleted_at`)
- ✅ Supabase schema and RLS written
- ✅ RLS isolation testing against real PostgreSQL
- ✅ P1 sync loop prevention (`dirty` flag, pure stamping rules)
- ✅ Checkpoint backup system
- ✅ P2 inventory migration (`3aba084`)
- ✅ `stock_movements` implementation, local side
- ✅ Stock integrity check shipped as a settings action
- ✅ P2b stock cache split: server `stock_movements` table plus the read-path
  fix (`fetchStockRows` reads the cache, movements verify and rebuild it)
- ✅ P3 membership architecture: `memberships`, five roles, `role_permissions`
  plus `has_permission()`, a validating active-pharmacy resolver, and the
  isolation suite checked into the repo

**Not started**

- ⬜ Authentication (Supabase Auth)
- ⬜ Sync engine (push and pull)

---

## Remaining Risks After P2

Recorded honestly so the next session does not rediscover them the hard way.

**1. Stock reads scanned the whole movement table. RESOLVED in `P2b`.**
`fetchStockRows()` no longer replays movements. See "The stock cache split"
below for the design and for why this must not be changed back.

**2. The server had no `stock_movements` table. RESOLVED in `P2b`.**
`supabase/01-schema.sql` now defines it and `supabase/02-policies.sql` gives it
pharmacy-scoped RLS with **select and insert only**. The SQL has still never
been applied to a live project.

**F1. Any authenticated user could claim any pharmacy as owner. RESOLVED in P3.**
The old `profile_insert` policy checked `user_id = auth.uid()` and never checked
`pharmacy_id`. See "P3 — membership architecture" below.

**F5. Invite codes were readable across every tenant. RESOLVED in P3.**
The old `invite_lookup` policy had no tenant predicate at all.

**3. The backfill cannot be re-run.** It skips when movements already exist, and
the append-only hook blocks deleting them. If a reconstruction bug is found
later, cleaning up requires a new schema version that rebuilds the log, since
there is no supported path to clear it. Design that escape hatch before it is
needed rather than during an incident.

**4. Dual write is enforced only by tests.** Nothing at compile time stops a
tenth stock-mutating path from being added without a movement. The browser suite
catches it; a developer who does not run it will not be warned. Treat the I5
test as mandatory before any change to `data.ts`.

**5. `ref_type` plus `ref_id` is not unique.** A stock entry can produce a
`purchase` movement and later `adjustment` movements from `updateStockEntry`.
The I4 uniqueness check passed because the seeded data had no edits. This is not
a correctness bug, but any future logic that assumes one movement per source
record is wrong.

**6. Reconstruction ordering is approximate.** Sale movements use the sale
timestamp for both date fields, while other kinds have separate entry and
creation times. The I6 negative-dip check is therefore a heuristic warning, not
a guarantee.

---

## P2b — The stock cache split

Two open risks from P2 were closed together, because they are one decision
about where stock quantity lives.

**`batches.qty_in_stock` is a maintained cache.** Not a legacy field, and not
the source of truth. `stock_movements` is the truth: an append-only log that
only ever grows. Both are written in the same transaction (the dual write),
so in normal running they are always equal.

**Screens read the cache.** `fetchStockRows()` reads `b.qty_in_stock`
directly. It used to call `computeAllBatchQty()`, which loaded every movement
on every inventory, dashboard, sales and stock-adjust load. Movements grow one
row per sale line, so that cost rose forever and never fell.

**The log is read for two things only:**

1. Verification and reconciliation, through `verifyStockIntegrity()`, which
   the settings screen already exposes as a button.
2. Rebuilding the cache, through `recomputeStockCache()`. This is what the sync
   engine must call after a pull: once another device's movements arrive, this
   device's counted number is stale, and only the log can settle it.

**One rule inside `planCacheRebuild()` matters more than the rest.** A batch
with no movements at all is skipped, never zeroed. Without that guard, a device
that had not run the P2 backfill would have its entire stock wiped to zero the
first time the cache was rebuilt. There is a test for exactly this.

**`recomputeStockCache()` writes `dirty: 0`.** The recomputed quantity is
derived from movements that are already synced, so pushing it back would be
noise, and on a slow link it would fight the server. It also preserves the
row's existing `updated_at` for the same reason.

**The `STOCK_SOURCE` switch is gone.** It selected between reading movements
and reading the counter, and it was P2's read-side rollback lever. It is no
longer meaningful: the cache is the read path, and the repair path is
`recomputeStockCache()` rather than a code edit. **The dual write itself is
unchanged and is still the rollback strategy** — it is what keeps the two in
step and what makes rebuilding possible.

**Server table.** `stock_movements` mirrors the local schema field for field,
with `unique (pharmacy_id, client_txn_id)` like the other transactional tables
and a `check` constraint carrying the same reason vocabulary as
`MovementReason` in `src/types/db.ts`. Keep those two lists in step. Append-only
is enforced twice on the server: RLS grants select and insert and nothing else,
and a trigger raises on update or delete so that even a service key cannot
quietly rewrite history. Repair work has to disable that trigger deliberately.

**Verified against real PostgreSQL 16**, the same way P1 was: a second pharmacy
cannot read or write another's movements, an update or delete through RLS
affects nothing, the trigger rejects owner-level writes, a duplicate
`client_txn_id` inside one pharmacy is rejected while the same value under a
different pharmacy is accepted, and an unknown reason is rejected.

**Known gap this exposes for the sync engine.** `markSynced()` clears `dirty`
with `table.update(...)`, but the append-only hook on `stock_movements` throws
on any update. Whoever builds push must clear the flag for movements another
way rather than relaxing the hook.

---

## P3 — Membership architecture

**Commit `P3_COMMIT`.** SQL only. Nothing under `src/` changed, and the
`stock_movements` table and its append-only trigger are byte-identical to P2b.

### What replaced what

`profiles(user_id PK)` is gone. `memberships(user_id, pharmacy_id)` keys on the
**pair**, so one person can belong to several pharmacies — an owner with two
branches, an accountant serving three shops. `is_default` marks which one opens
first.

`member_role` widened from owner and staff to **owner, manager, cashier,
inventory, accountant**. Policies no longer test role names anywhere. They call
`has_permission('sales.cancel')`, and `role_permissions` (seeded in
`03-permissions.sql`) decides who holds what. Changing who may cancel a sale is
now an `insert` and a `delete`, not a policy rewrite.

### The two security fixes, and why they were mandatory here

**F1 — claiming a pharmacy.** The old insert policy validated *who you are* and
never *which tenant you were joining*. The only thing stopping a stranger from
inserting themselves as owner of a pharmacy id they had seen was the primary key
on `user_id` — and this phase removes that key. Carrying the policy over would
have turned an accident into an open door.

`pharmacies` gained `created_by`. There are now exactly three ways a membership
can come into existence, and each is checked:

1. **Bootstrap** — you may make yourself owner of a pharmacy only if you created
   it *and* nobody has joined it yet (`can_bootstrap_owner()`).
2. **Invitation** — `redeem_invite(code)`, `security definer`. The role comes
   from the invite, never from the joiner, so nobody walks in as an owner.
3. **Administration** — a member with `members.manage` adds someone to the
   pharmacy they are currently working in. Only an owner may mint another owner.

**F5 — invite codes.** The old policy was `using (used_by is null and
expires_at > now())` with no tenant predicate, so any authenticated user could
list every live code in the system and join any shop. Now the table is readable
only within your own pharmacy and only with `members.manage`. Someone who is not
yet a member validates a code through `invite_preview()`, which requires the
complete code and returns one row — no listing, no enumeration. **Codes must
therefore be long and random;** a short or guessable code defeats this.

### The active-pharmacy resolver

`auth_pharmacy_id()` is the piece that had to be right. Given a claim from the
client it returns that pharmacy **only** when a membership row exists. A claim
that is present but does not parse, or parses but does not match a membership,
returns null rather than falling through to the user's default — falling through
would let a bad claim quietly succeed as something else. Null means zero rows
everywhere under RLS.

### One PostgreSQL trap this uncovered

The first run of the new suite caught a cashier promoting himself to manager.
The cause is worth remembering: **when several permissive policies exist on a
table, PostgreSQL ORs their `using` clauses and, separately, ORs their
`with check` clauses.** The cashier failed the admin policy's `using`, but his
new row satisfied that policy's weaker `with check`, and that was enough.

Every `with check` in `02-policies.sql` is therefore self-sufficient: it
re-asserts both the tenant and the permission rather than relying on the `using`
beside it. Keep it that way when adding policies.

### The isolation suite is now in the repo

```
bash supabase/run-isolation-test.sh
```

It builds a scratch database, applies schema, policies and permissions, runs
**85 cases**, prints a pass/fail table and raises an exception if anything
failed, then drops the database. It touches no live project. Run it on every
policy change — that is the whole point of checking it in.

Coverage: the seven original P1 cases unchanged, the F1 attack exactly as the
audit proved it live, F5 enumeration from three angles, the resolver fed a
pharmacy the user does not belong to, multi-membership switching, all five role
boundaries, self-escalation, membership removal, and `stock_movements` isolation
plus its append-only rule.

### Deliberately not done

Authentication, the sync engine, the pharmacy switcher and any permission admin
screen. P3 prepares the database and stops.

---

## Next Starting Point

> **Authentication: Supabase Auth on top of the membership model P3 built.**

The database side is ready. What authentication has to add:

- Sign-up creates the pharmacy and then the bootstrap owner membership, in that
  order — the second step depends on `created_by` from the first.
- Sign-in must choose an active pharmacy for a user with several memberships and
  send it as the claim `auth_pharmacy_id()` reads. On Supabase that is a request
  header or a JWT claim; the resolver already validates whatever arrives.
- Joining a shop calls `redeem_invite(code)`, never a direct insert.
- The 8-digit PIN stays as a quick screen lock, not the account key.

Still true, and still worth hurrying: **the SQL has never been applied to a live
Supabase project.** Every policy remains free to change. That ends the moment a
real project exists.

---

## Files To Review First

**Database and migrations**
- `src/lib/db/local.ts` — schema versions 1–3, hooks, seeding, export/import
- `src/lib/db/stamp.ts` — the stamping rules (read this before touching sync)
- `src/lib/db/checkpoint.ts` — migration snapshots

**Stock**
- `src/lib/stock/reconstruct.ts` — pure replay rules, read before changing stock
- `src/lib/stock/backfill.ts` — the migration and its two cross-checks
- `src/lib/stock/movements.ts` — writing, `verifyStockIntegrity()` and
  `recomputeStockCache()`. The read helpers here scan the whole log; they are
  verification tools and must not be called while drawing a screen

**Sync**
- `src/lib/sync/state.ts` — cursors, failures, retry timing. No sync engine yet

**Business logic**
- `src/lib/data.ts` — ~1,400 lines, the single gateway for every mutation.
  Every page imports from here; no page touches Dexie directly. This is the
  file P2 changes, and its nine stock-mutating functions are: `createSale`,
  `addStock`, `adjustStock`, `createSaleReturn`, `cancelSale`,
  `updateStockEntry`, `cancelStockEntry`, `cancelStockAdjustment`,
  `cancelSaleReturn`

**Types**
- `src/types/db.ts` — `SyncFields` and every entity type

**Server**
- `supabase/01-schema.sql` — tables plus the helper functions. Read
  `auth_pharmacy_id()` before changing anything about tenancy
- `supabase/02-policies.sql` — every policy, with the `with check` rule above
- `supabase/03-permissions.sql` — who may do what. Change roles here, not in policies
- `supabase/test-isolation.sql` + `run-isolation-test.sh` — 85 cases; run on every
  policy change
- `supabase/00-test-harness.sql` — the local `auth` stub. **Test only.** Supabase
  provides the real one; running this against a live project would be a mistake
- None of it has been applied anywhere yet

**Planning**
- `docs/P3-PLAN.md` — the next task
- `docs/P2-INVARIANTS.md` — the conditions P2 was held to, all met
- `docs/SAAS-ROADMAP.md` — the phase plan and cost reality
- `docs/00-PROJECT-PLAN.md` — the original design, partly historical

---

## Do Not Do

- **Do not rewrite the database without a migration.** Never rename
  `asshifa_local`, never drop a store, never remove a field. Every existing
  device holds real pharmacy accounts in that database.
- **Do not remove `qty_in_stock`.** It is the maintained cache every screen
  reads, and the dual write that keeps it correct is the rollback strategy for
  the highest-risk change in the project.
- **Do not make `fetchStockRows()` replay movements again.** That was the
  performance regression fixed in P2b. If the displayed number looks wrong, the
  answer is `verifyStockIntegrity()` and then `recomputeStockCache()`, not a
  full scan on every page load.
- **Do not start authentication before P2 and P3 are decided.** Auth built on
  the current single-pharmacy `profiles` table would have to be rewritten, and
  auth built before `stock_movements` would let real multi-device use start on
  a stock model that silently loses sales.
- **Do not bypass the checkpoint approach.** Any migration that transforms data
  takes a checkpoint in the same transaction, verifies, and aborts rather than
  half-applying.
- **Do not select rows to push by timestamp.** Use `dirty`. See decision 1.
- **Do not apply server data without `dirty: 0`.** See decision 3.
- **Do not edit or delete a `stock_movements` row.** Write an opposite movement
  instead. Hooks enforce this and will throw.
- **Do not merge `independentReplay` with `reconstructMovements`.** They exist
  to disagree when one of them is wrong.
- **Do not add a stock-mutating path without a movement write** in the same
  transaction, and run the I5 browser test afterwards. Nothing at compile time
  will catch the omission.
- **Do not give the server `stock_movements` table an update or delete
  policy**, and do not drop its append-only trigger. Write a reversing movement.
- **Do not write a `with check` that leans on its own `using` clause.**
  PostgreSQL ORs the `with check` of every permissive policy on the table, so a
  weak one is a hole regardless of how strict its neighbour is. This was a real
  bug, caught by the isolation suite.
- **Do not add a membership insert path that does not verify the pharmacy.**
  Checking `user_id = auth.uid()` alone is finding F1 all over again.
- **Do not give `invites` a select policy without a tenant predicate.** That was
  finding F5. Code validation for non-members goes through `invite_preview()`.
- **Do not change a policy without re-running `supabase/run-isolation-test.sh`.**
  It is checked in precisely so this is one command.
- **Do not add a new store to `SYNCED_TABLES_V3`.** It is frozen because devices
  still on v2 replay that upgrade. Use `SYNCED_TABLES`.
