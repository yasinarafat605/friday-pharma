# Friday Pharma Development Handoff

> Read this before changing anything. It exists so a new session can pick up
> the work without re-deriving decisions that were already made deliberately.
>
> Last updated after commit `8a198f8` (P1 complete). Next work item is P2.

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

---

## Current Database State

- **IndexedDB database name:** `asshifa_local` — **deliberately unchanged**
  through the rebrand. Renaming it would orphan every record on every existing
  device.
- **Current Dexie schema version: 3** (IndexedDB reports this as `30`).
  Versions 1 and 2 remain declared in `local.ts` and must stay there so devices
  on older versions can upgrade through them.
- **Stores added in v3:** `sync_state`, `sync_failures`, `_checkpoints`.
- **Field added in v3:** `dirty` on the 14 synced stores, indexed.
- **Synced stores (14):** medicines, batches, stock_entries, customers,
  customer_ledger, sales, sale_items, due_payments, expense_categories,
  expenses, cash_sessions, stock_adjustments, sale_returns, sale_return_items.
  `settings` and `audit_logs` are **not** stamped — this is finding P5 in the
  audit and still needs a deliberate decision.
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
5. **Stock must move to a `stock_movements` architecture.** `qty_in_stock` is
   currently a mutable counter written by nine code paths. Two devices selling
   offline both write an absolute value and last-write-wins silently loses one
   sale. Stock must become an append-only movement log with the quantity as a
   recomputed projection. This is P2 and is the highest-risk item remaining.
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

**Not started**

- ⬜ P2 inventory migration
- ⬜ `stock_movements` implementation
- ⬜ P3 membership architecture
- ⬜ Authentication (Supabase Auth)
- ⬜ Sync engine (push and pull)

---

## Next Starting Point

> **P2 planning: migrate inventory from mutable `qty_in_stock` to immutable
> `stock_movements` without changing visible stock.**

**Read `docs/P2-INVARIANTS.md` first.** It defines the eight conditions the
migration must prove and where each is tested. The migration does not ship
unless I1 through I5 pass against real data, not fixtures. That document is
binding, not advisory.

The approved approach, from the implementation plan:

- Add an append-only `stock_movements` store. Movements are never edited or
  deleted; a cancellation writes an opposite movement.
- Backfill by replaying only records that are still active. Cancellations were
  applied by editing the counter rather than writing a reversing row, so a
  naive replay of everything produces the wrong figure:
  - `+` stock_entries where status ≠ cancelled
  - `−` sale_items where the sale is completed
  - `+` stock_adjustments where status ≠ cancelled (qty is already signed)
  - `+` sale_return_items where restock and the return is active
- Compare the computed total against the stored `qty_in_stock`. Any difference
  is written as an explicit `opening_balance` movement so **no displayed stock
  figure changes**. Expect zero; handle non-zero honestly.
- Assert that movements sum to the stored quantity for every batch before
  committing. If any batch fails, abort and leave the counter in charge.
- Dual write during the transition: the nine mutating functions write a
  movement **and** keep updating `qty_in_stock`. Reads switch to the recomputed
  total. This is what makes rollback a one-line switch.
- The nine transactions that mutate stock gain `stock_movements` in their
  scope. Unlike the outbox case in P1, this is correct — a stock movement is
  business data and must commit atomically with the sale that caused it.
- `verifyStockIntegrity()` ships as a permanent function with a button in
  settings, not as migration-only scaffolding. It is the check that later
  proves a multi-device sync merged correctly.

---

## Files To Review First

**Database and migrations**
- `src/lib/db/local.ts` — schema versions 1–3, hooks, seeding, export/import
- `src/lib/db/stamp.ts` — the stamping rules (read this before touching sync)
- `src/lib/db/checkpoint.ts` — migration snapshots

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
- `docs/P2-INVARIANTS.md` — **binding** conditions and tests for P2
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
- **Do not ship P2 without the invariant tests in `docs/P2-INVARIANTS.md`.**
  Particularly I3: the abort path must be exercised by a test that deliberately
  breaks a batch. An untested abort path is not an abort path.
- **Do not edit or delete a `stock_movements` row.** Write an opposite movement
  instead. A hook will enforce this once P2 lands.
