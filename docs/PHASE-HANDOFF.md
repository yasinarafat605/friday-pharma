# Friday Pharma Development Handoff

> Read this before changing anything. It exists so a new session can pick up
> the work without re-deriving decisions that were already made deliberately.
>
> Last updated after commit `3aba084` (P2 complete). Next work item is P3.

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

**Not started**

- ⬜ P3 membership architecture
- ⬜ `stock_movements` on the **server** (P2 was local only — see risks below)
- ⬜ Authentication (Supabase Auth)
- ⬜ Sync engine (push and pull)

---

## Remaining Risks After P2

Recorded honestly so the next session does not rediscover them the hard way.

**1. Stock reads now scan the whole movement table.** `fetchStockRows()` calls
`computeAllBatchQty()`, which loads every movement on every inventory and
dashboard load. Movements grow one row per sale line, far faster than batches
did, so this is a performance regression on the hottest screens and it worsens
forever. It is survivable today and `STOCK_SOURCE` can flip reads back, but the
proper fix is to treat `qty_in_stock` as a **maintained cache** rather than
either the truth or a legacy field: keep the dual write, read the cache, and use
movements for verification and for recomputing after a sync pull. That is the
better long-term design and should be settled before the sync engine lands.

**2. The server has no `stock_movements` table.** P2 deliberately did not touch
`supabase/*.sql`, so the local store has no server counterpart. Sync would drop
every movement. **P3 must add it**, with `unique (pharmacy_id, client_txn_id)`
like the other transactional tables.

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

## Next Starting Point

> **P3: replace the single-pharmacy `profiles` table with membership-based
> access, and add the server-side tables P2 left behind.**

**Read `docs/P3-PLAN.md`** for the full approach. In short:

- `profiles(user_id PK)` becomes `memberships(user_id + pharmacy_id PK, role)`,
  so one person can belong to more than one pharmacy.
- `member_role` widens from owner and staff to owner, manager, cashier,
  inventory and accountant.
- A seeded `role_permissions` lookup plus a `has_permission(text)` helper
  replaces role-name checks inside policies.
- `auth_pharmacy_id()` resolves the **active** pharmacy and always validates it
  against membership, so a client cannot pick its own tenant.
- `stock_movements` is added server-side — P2 was local only.

P3 is unusually cheap right now: no application file references `profiles`, and
the SQL has never been applied to a live Supabase project. It is editing files
no database has yet consumed. That stops being true the moment a project exists.

---

## Files To Review First

**Database and migrations**
- `src/lib/db/local.ts` — schema versions 1–3, hooks, seeding, export/import
- `src/lib/db/stamp.ts` — the stamping rules (read this before touching sync)
- `src/lib/db/checkpoint.ts` — migration snapshots

**Stock**
- `src/lib/stock/reconstruct.ts` — pure replay rules, read before changing stock
- `src/lib/stock/backfill.ts` — the migration and its two cross-checks
- `src/lib/stock/movements.ts` — writing, reading and `verifyStockIntegrity()`

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
- `supabase/01-schema.sql`, `supabase/02-policies.sql` — not yet applied
  anywhere, so they are still free to change (this is why P3 is cheap now)

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
- **Do not remove `qty_in_stock` yet.** It stops being the source of truth
  during P2 but must keep being written. That dual write is the entire rollback
  strategy for the highest-risk change in the project.
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
- **Do not add a new store to `SYNCED_TABLES_V3`.** It is frozen because devices
  still on v2 replay that upgrade. Use `SYNCED_TABLES`.
