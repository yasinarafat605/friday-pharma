# P3 — Membership-Based Access

> **Done.** Kept as the record of what was planned; what was actually built is
> in `docs/PHASE-HANDOFF.md` under "P3 — membership architecture". Two things
> came out differently: `stock_movements` was already added in P2b rather than
> here, and the audit's findings F1 and F5 were folded in as core requirements.
>
> P3 was SQL-only as planned. **No application file changed.**

---

## Why now, and why it is cheap

`profiles.user_id` is the primary key, so the row *is* the membership. One
person can belong to exactly one pharmacy, permanently. That rules out an owner
with two branches, an accountant serving several shops, and a cashier moving
between shops — all normal in this market.

Right now this costs two file edits, because **the SQL has never been applied to
a live Supabase project and zero users exist**. After launch it means migrating
live accounts and rewriting every policy that calls `auth_pharmacy_id()`.

P3 also closes a gap P2 left deliberately: the server has no `stock_movements`
table, so sync would silently drop every movement.

---

## Database changes

### 1. `profiles` becomes `memberships`

| From | To |
|---|---|
| `profiles(user_id PK, pharmacy_id, role)` | `memberships(user_id, pharmacy_id, role, is_default, joined_at)` with the **pair** as primary key |

`is_default` marks which pharmacy opens first for a user who belongs to several.

### 2. Roles widen

```
member_role: owner | staff
          →  owner | manager | cashier | inventory | accountant
```

### 3. Permissions become a lookup, not a role-name check

New `role_permissions(role, permission)`, seeded. Policies stop testing role
names and call `has_permission('sales.cancel')` instead. Adding accountant later
becomes a few inserted rows rather than a schema migration and a policy rewrite.

| Role | Can | Cannot |
|---|---|---|
| owner | everything, including billing and members | — |
| manager | all shop operations, reports, cancellations | billing, managing members |
| cashier | sell, collect due, view stock | see profit, cancel, edit prices, settings |
| inventory | add and adjust stock, edit medicines and batches | see money figures |
| accountant | read every report and export | change any record |

Only owner, manager and cashier get exposed in the app during authentication
work. The other two cost nothing extra once the structure exists.

### 4. `stock_movements` on the server

Mirrors the local store added in P2, with `unique (pharmacy_id, client_txn_id)`
like every other transactional table, and no delete policy — movements are
append-only on both sides.

### 5. Helper functions rewritten

`auth_pharmacy_id()` must now resolve the **active** pharmacy rather than the
only one, and must always validate it:

1. If the request carries an active pharmacy, return it **only** when a
   membership row exists for that user and that pharmacy.
2. If it carries nothing and the user belongs to exactly one pharmacy, return
   that one.
3. Otherwise return null, which under row level security means zero rows
   everywhere.

The validation is the important half. A client that asks for a pharmacy it has
no membership in gets nothing, so a compromised or buggy client cannot pick its
own tenant. `is_owner()` and `pharmacy_is_active()` are rewritten against
`memberships` the same way.

---

## Files that will change

| File | Change |
|---|---|
| `supabase/01-schema.sql` | memberships replaces profiles, role enum widened, `stock_movements` added, helper functions rewritten |
| `supabase/02-policies.sql` | 16 policies rewritten against memberships and `has_permission` |
| `supabase/03-permissions.sql` | **New.** Seeded role-to-permission rows |
| `supabase/test-isolation.sql` | **New.** The isolation test checked into the repo so it can be re-run on every policy change |
| `docs/PHASE-HANDOFF.md` | Updated on completion |

**Not touched:** everything under `src/`. If P3 finds itself editing
application code, something has gone wrong — stop and re-read this plan.

---

## Verification

The isolation test from Phase 1 is checked into the repo, extended, and re-run
against real PostgreSQL. Every original case must still pass unchanged:

- each owner sees only their own rows
- requesting another pharmacy's rows by id returns zero, not an error
- writing into another pharmacy is rejected
- moving a row to another pharmacy is rejected
- financial records cannot be deleted at all
- staff cannot change settings or the plan
- an unauthenticated caller sees nothing

New cases that only exist once memberships do:

1. A user belonging to two pharmacies sees exactly one at a time, and switching
   the active pharmacy changes what they see.
2. Asking for a pharmacy you have no membership in returns nothing rather than
   an error that reveals it exists.
3. A cashier cannot perform a manager's action, checked through
   `has_permission` rather than a role name.
4. An accountant can read reports but every write is refused.
5. Removing a membership immediately removes access to that pharmacy's rows.
6. `stock_movements` obeys tenant isolation like every other table, and cannot
   be updated or deleted.

Postgres installs with apt in the container; `initdb` refuses to run as root, so
run it as the `postgres` user.

---

## Risks

**Low overall.** No live database, no application code, and the isolation test
already exists and passes today, so a regression is visible immediately.

The one thing to get right is the active-pharmacy resolver. A version that
trusts the client's claim without checking membership would be a cross-tenant
hole in the exact place this whole design exists to protect. Test case 2 above
is the one that catches it.

---

## Not in P3

Authentication, the sync engine, the app's pharmacy switcher and any permission
admin interface. P3 prepares the database for all of them and stops there.
