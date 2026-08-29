# P2 — Stock Invariants and Verification

> Required reading before writing any P2 code. These are the conditions the
> migration must **prove**, not assume. If a check here cannot be satisfied,
> the migration does not ship.
>
> Context: `qty_in_stock` is currently a mutable counter written by nine code
> paths. P2 replaces it with an append-only `stock_movements` log, with the
> quantity becoming a recomputed projection. The danger is silent arithmetic
> error, so every claim below is written as something a test can fail.

---

## Notation

- `B` — a batch row.
- `counter(B)` — the stored `batches.qty_in_stock`.
- `computed(B)` — sum of `qty_delta` over live movements for `B`.
- `displayed(B)` — what `fetchStockRows()` returns for `B`. This is what every
  screen actually renders, so it is the honest definition of "visible stock".
- **Active** record — `status ≠ 'cancelled'` and `deleted_at` is null.

---

## The invariants

### I1 — Visible stock is identical before and after migration

For every batch, and for every figure derived from stock:

```
displayed_after(B)         == displayed_before(B)
stock_value_after          == stock_value_before
low_stock_count_after      == low_stock_count_before
expiring_count_after       == expiring_count_before
expired_count_after        == expired_count_before
```

This is the promise made to Mejbah and it is not negotiable. The migration
writes history to match the current stock, never the reverse.

### I2 — Movements reconcile to the counter

```
for every batch B:   computed(B) == counter(B)
```

Must hold immediately after backfill and continuously afterwards. This is the
single assertion that makes the whole architecture trustworthy.

### I3 — Any mismatch stops the migration safely

If I2 fails for even one batch, the migration must:

1. Roll back its transaction, leaving zero `stock_movements` rows persisted.
2. Leave the schema at the previous version.
3. Leave `qty_in_stock` as the source of truth and the app fully usable.
4. Report which batches failed, with `counter`, `computed` and the difference.

The failure path must be **exercised by a test**, not merely written.

### I4 — No sale, purchase, cancellation or adjustment disappears

Two directions, both checked:

**Completeness** — every active source record produces exactly one movement:

| Source | Condition | Movement |
|---|---|---|
| `stock_entries` | active | `+qty`, reason `purchase` |
| `sale_items` | parent sale completed | `−qty`, reason `sale` |
| `stock_adjustments` | active | `+qty` (already signed), reason `adjustment` |
| `sale_return_items` | `restock` and parent return active | `+qty`, reason `return` |

**No fabrication** — every movement except `opening_balance` carries a
`ref_type` and `ref_id` pointing at a record that exists.

Counts must match per reason:

```
count(movements reason='purchase')   == count(active stock_entries)
count(movements reason='sale')       == count(sale_items of completed sales)
count(movements reason='adjustment') == count(active stock_adjustments)
count(movements reason='return')     == count(restocked items of active returns)
```

Cancelled records are correctly absent: their effect was already undone by
editing the counter, so replaying them would double-count. This is the subtlety
that makes a naive full replay wrong.

### I5 — Dual write keeps both systems consistent

During the transition every mutating operation writes a movement **and**
updates the counter, inside the same transaction. Therefore:

```
after every one of the nine operations:   computed(B) == counter(B)
```

The nine: `createSale`, `addStock`, `adjustStock`, `createSaleReturn`,
`cancelSale`, `updateStockEntry`, `cancelStockEntry`, `cancelStockAdjustment`,
`cancelSaleReturn`.

This is the regression net. If someone later adds a tenth path and forgets the
movement, this test fails immediately rather than months later during a
physical stock count.

---

## Three further invariants worth enforcing

Not requested, but cheap and they close real gaps.

### I6 — Reconstructed history never dips negative

```
running_total(B) at every point in time >= 0
```

A negative dip means the replay ordering is wrong, since a shop cannot sell
stock it has not received. Treated as a **warning** rather than a hard failure,
because true historical ordering cannot always be recovered from timestamps
alone — but every warning is reported and reviewed before shipping.

### I7 — Movements are append-only, enforced not just intended

A Dexie hook on `stock_movements` throws on any update or delete. Corrections
are made by writing an opposite movement. This turns engineering decision 4
(financial records are immutable) from a convention into something the database
refuses to violate.

### I8 — The backfill is idempotent

Running it twice must not double anything. If `stock_movements` already holds
rows for this pharmacy, the backfill skips. A migration that failed midway and
is retried is a realistic scenario, and a doubled stock log would be worse than
the bug being fixed.

---

## Verification: where each invariant is proved

### Unit tests (vitest, pure functions)

The reconstruction arithmetic is extracted into a pure function so it can be
tested against fixtures without a database. Fixture matrix, one case each:

1. Plain purchase, nothing else
2. Purchase then partial sale
3. Purchase, sale, then that sale cancelled
4. Purchase then the stock entry cancelled
5. Purchase with the entry quantity later edited up, and separately down
6. Adjustment down for damage, then that adjustment cancelled
7. Return with restock; return without restock; return then cancelled
8. Batch created but never stocked (zero movements)
9. Counter and computed deliberately disagree → expect an `opening_balance` row
   of exactly the difference
10. **Two returns against one sale, one of them cancelled** — the scenario that
    produced the real ledger bug found in QC, kept as a permanent regression

Each asserts I2 and I4 on the reconstructed result.

### Browser integration tests (Playwright, seeded database)

| Test | Proves |
|---|---|
| Snapshot `fetchStockRows()` and all dashboard stock figures before and after the upgrade, deep-compare | **I1** |
| Assert `verifyStockIntegrity()` returns ok on a realistic seeded database | **I2** |
| Deliberately skew one batch's counter, run the migration, assert it aborts, the schema version is unchanged, zero movements persist, and the failing batch is named | **I3** |
| Compare per-reason counts against the source tables in both directions | **I4** |
| Run all nine operations in sequence, asserting integrity after each | **I5** |
| Check running totals across the reconstructed timeline | **I6** |
| Attempt to update and to delete a movement, assert both throw | **I7** |
| Run the backfill twice, assert identical row counts | **I8** |

### Verification against real data

The final gate is not a fixture. The checks run against Mejbah's actual
As-Shifa database before P2 is considered done. Fixtures prove the logic;
his data proves the migration.

---

## Shipped verification tool

`verifyStockIntegrity()` is not migration-only scaffolding. It ships as a
permanent function and gets a button in settings — **"স্টকের হিসাব মিলিয়ে
দেখুন"** — reporting per batch: counter, computed, and any difference.

Reasons this earns its place:

- Turns an invariant into something the shop owner can check themselves.
- Gives support a first question that costs one tap: does the stock reconcile.
- Once sync exists, it becomes the check that proves a multi-device merge
  landed correctly.

---

## Ship gate

P2 is complete only when **I1 through I5 pass on real data**, I6 produces no
unexplained warnings, and I7 and I8 pass on fixtures. Anything less and the
counter stays in charge.
