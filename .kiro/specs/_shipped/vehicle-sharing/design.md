# Vehicle Sharing — Design

> DRAFT (2026-06-24), paired with `requirements.md`. **Design-first; nothing builds until T0 (Angelo
> ratifies D1–D8 in requirements.md).** Backend-first per CLAUDE.md, exactly like trips/recurring/import:
> schema → repository → routes/validation → backup → analytics-N/A → frontend (eyes-on tail).
>
> Grounded against the live code (2026-06-24): `backend/src/db/schema.ts` (`users` id/email, `vehicles`
> userId-scoped, latest migration `0005_license_plate_per_user.sql` → sharing is **0006**), the
> `validateXOwnership` family in `backend/src/utils/validation.ts`, and `cross-tenant-idor.test.ts`.

## §1 — Schema (migration 0006, additive)
```ts
// schema.ts — additive; no change to existing tables
export const vehicleShares = sqliteTable(
  'vehicle_shares',
  {
    id: text('id').primaryKey(),                       // uuid
    vehicleId: integer('vehicle_id').notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),   // revoke-on-vehicle-delete (D8)
    ownerId: text('owner_id').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),      // denormalized for fast owner-side list
    sharedWithId: text('shared_with_id').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),      // the invitee
    level: text('level').notNull(),                    // 'viewer' | 'editor'   (Zod enum at the route)
    status: text('status').notNull().default('pending'), // 'pending'|'accepted'|'declined'|'revoked'
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => ({
    // one active share per (vehicle, invitee) — partial unique so a declined/revoked row can be re-invited
    uniqActive: uniqueIndex('vehicle_shares_active_idx')
      .on(t.vehicleId, t.sharedWithId)
      .where(sql`status in ('pending','accepted')`),
    bySharedWith: index('vehicle_shares_shared_with_idx').on(t.sharedWithId, t.status),
    byOwner: index('vehicle_shares_owner_idx').on(t.ownerId),
  }),
);
```
- `ownerId` is denormalized (derivable via `vehicles.userId`) ONLY to make the owner-side "list my shares"
  query index-friendly; the load-bearing ownership truth stays `vehicles.userId` (validated at write).
- Migration 0006 is a single additive `CREATE TABLE` + indexes (the 0003 additive class — no backfill,
  no rebuild). Mirror `migration-0004.test.ts`: table exists, FKs cascade, partial-unique rejects a dup
  active share but allows re-invite after decline.

## §2 — The access model (the heart; R3/R4/R6)
A new helper that REPLACES `validateVehicleOwnership` ONLY on the shared-readable/writable routes:
```ts
// utils/sharing.ts (new)
type Access = { role: 'owner' } | { role: 'viewer' } | { role: 'editor' } | null;
// resolveVehicleAccess(db, vehicleId, actingUserId): owner if vehicles.userId === acting;
//   else the accepted share's level; else null (→ 404, never 403 — don't leak existence).
async function requireVehicleRead(db, vehicleId, userId): Promise<Access>   // owner|viewer|editor or 404
async function requireVehicleWrite(db, vehicleId, userId): Promise<Access>  // owner|editor or 404
```
- **Existence-hiding:** no-access returns the SAME 404 a non-existent vehicle returns (enumeration-oracle
  discipline, the #80 lesson). Never 403.
- **Owner-only actions** (delete vehicle, edit financing/purchase price, manage shares) keep the STRICT
  `validateVehicleOwnership` (owner === acting) — `requireVehicleWrite` is NOT enough for them.
- Existing read/write routes change from `validateVehicleOwnership(...)` to `requireVehicleRead/Write(...)`
  ONE DOMAIN PER SLICE (expenses, then odometer, then reminders, then insurance-read, then analytics-read).

### §2.1 — The editor-WRITE model (T5b; RATIFIED by Angelo 2026-06-27 = option (a) owner-stamp + createdBy)
> THE money-data-safety core of the whole feature. Ratified after the T5b escalation. The naive
> "flip the gate" is WRONG because expenses/odometer/reminders are **`userId`-keyed** (reads filter
> `eq(userId)`, creates stamp the acting user, backup/TCO query by `userId`). A shared editor stamping
> their OWN userId would make the row vanish from the owner's backup+TCO and double-count cross-fleet.
> The ratified model fixes this with two coordinated rules:

1. **OWNER-STAMP on shared-created rows (the load-bearing rule).** When an EDITOR (non-owner) creates an
   expense / odometer / reminder on a shared vehicle, the row's `userId` is stamped with the **vehicle
   OWNER's** id (resolved via `resolveVehicleAccess` → the owner is `vehicles.userId`), NOT the editor's.
   Consequence (all desirable, and all already assumed by the C54 backup design + the `vehicleShares`
   schema header): the row rides the OWNER's backup, counts once in the OWNER's TCO, and stays on
   revoke/delete as real cost history. An OWNER creating on their own vehicle is unchanged (stamps self).

2. **`createdBy` column (migration 0011, additive) records the ACTUAL author.** New nullable
   `created_by` text column → `users.id` (no cascade delete of the row; SET NULL or leave dangling-safe —
   it is provenance, not ownership). `userId` = whose vehicle/books the row belongs to (owner);
   `createdBy` = who physically entered it (editor or owner). NULL `createdBy` ⇒ legacy/self-created
   (treat as `createdBy == userId`). Backfill: existing rows get `created_by = user_id` is NOT required —
   NULL is the legacy sentinel, so the migration is pure additive `ALTER TABLE ADD COLUMN` (no rebuild,
   avoids the C15/0004 cascade-wipe footgun; write the snapshot so 0012 diffs clean).

3. **READS must resolve shared access by `vehicleId`, not `userId` (the rework).** Because shared-created
   rows are stamped `userId=owner`, a shared editor querying their OWN list (`findPaginated({userId:me})`)
   will NOT see the shared vehicle's expenses. So the per-vehicle read routes (expense list/summary,
   odometer history/getCurrentOdometer, reminders) gate via `requireVehicleRead(vehicleId, acting)` and
   then query **by `vehicleId`** (the row's `userId` is the owner, which the editor is allowed to read for
   that vehicle). The cross-fleet/dashboard aggregates (`getPerVehicleStats`, `getSummary`) stay
   `userId`-scoped = the acting user's OWNED books only — a shared vehicle's costs belong to the OWNER's
   dashboard, NOT the editor's (the editor sees them only when viewing that specific shared vehicle). This
   keeps TCO/analytics correct on BOTH sides with no double-count.

4. **`getCurrentOdometer` cross-user fix.** It MAX-UNIONs expenses.mileage + odometer rows scoped
   `vehicle_id = ? AND user_id = ?`. For a shared vehicle every row is owner-stamped, so scope that read
   by the **owner's** userId (resolved from the share), not the acting editor's — else the editor's
   newly-entered reading (also owner-stamped) is the only one visible and lease/mileage math breaks.

5. **Owner-only actions remain STRICT.** Delete-vehicle, financing/purchase-price edit, and
   share-management keep `validateVehicleOwnership` (owner===acting). An editor passing `requireVehicleWrite`
   must NOT reach them — verified by an `editor-owner-action-denied` IDOR entry.

**Build order (one verified slice/cycle, each shipping its `cross-tenant-idor.test.ts` entries):**
T5b-1 migration 0011 (additive `created_by` + schema type + migration test) → T5b-2 expense WRITE
(POST/PUT/DELETE via `requireVehicleWrite`, owner-stamp + `createdBy`, IDOR) → T5b-3 expense READ
(list/summary by vehicleId for shared, IDOR) → T6 odometer (write+read+getCurrentOdometer owner-scope) →
T7 reminders → T8 insurance/analytics READ + viewer-no-edit (T12b-3). Each is green→green; never commit red.

## §3 — Routes (`/api/v1/shares`, new router) + the gate-widening
**New share-management endpoints:**
| Method | Path | Who | Action |
|---|---|---|---|
| POST | `/shares` | owner | invite `{vehicleId, email, level}` → pending (R1; `validateVehicleOwnership`) |
| GET | `/shares/granted` | owner | shares I granted (all my vehicles) |
| GET | `/shares/received` | invitee | shares to me (pending + accepted) |
| POST | `/shares/:id/accept` | invitee | pending→accepted (only `sharedWithId === acting`) |
| POST | `/shares/:id/decline` | invitee | pending→declined / accepted→self-removed |
| PUT | `/shares/:id` | owner | change `level` (owner of the share's vehicle only) |
| DELETE | `/shares/:id` | owner | revoke (→ revoked) |
| GET | `/vehicles?include=shared` | invitee | fleet list widens to owner-vehicles ∪ accepted-shared |

**Gate-widening (per-domain slices):** expenses/odometer/reminders/insurance/analytics READ routes use
`requireVehicleRead`; expenses/odometer/reminders WRITE routes use `requireVehicleWrite`. Each slice adds
its IDOR-sweep entries (R6) in the SAME cycle.

## §4 — Backup / restore (R7, NORTH_STAR #1)
- `vehicle_shares` joins the table-coverage maps (both source-scan guards) + `validateReferentialIntegrity`
  (vehicleId→vehicles, ownerId/sharedWithId→users). Owner-side export includes shares they granted; the
  invitee's export does NOT include the owner's vehicle or the share (it isn't theirs — `userId`-stamp is
  the owner). Round-trip test: seed shares → export → wipe → restore → identical (D7 decides pending-invite
  re-creation).
- Revocation cascade (D8): FK `onDelete:'cascade'` drops shares when the vehicle/owner is deleted;
  shared-created expense rows STAY (real cost history, owner-`userId`-stamped — never deleted).

## §5 — Frontend (eyes-on tail, R8 — Playwright-blocked → "code-complete, eyes-on pending")
- `share-api.ts` client (the C149/C163 service pattern). A "Share" dialog on the vehicle page (owner:
  email + level + current-shares list with revoke/level-change). A "Shared with me" section + pending-invite
  accept/decline surface (settings or fleet). Fleet cards badged "shared by <name>"; viewer sees NO edit
  affordances (the `requireVehicleWrite` denial mirrored in the UI). Four-states + a11y + mobile; then the
  FE→BE→DB e2e.

## §6 — Risk register (why this is the highest-care feature)
1. **Cross-tenant widening** is the entire feature — every gate change is a potential IDOR. Mitigation:
   `requireVehicleRead/Write` is the ONE seam; every route through it gets a `cross-tenant-idor.test.ts`
   entry in the same slice (third-party-denied, viewer-write-denied, editor-other-vehicle-denied,
   editor-owner-action-denied). No slice is "done" without its IDOR entries (the C108–C116 method).
2. **Existence leak** — always 404, never 403 (#80 enumeration-oracle).
3. **Owner-only escalation** — delete/financing/share-management must NOT accept an editor; keep strict
   `validateVehicleOwnership` on those, separate from `requireVehicleWrite`.
4. **Backup blast radius** — a share must never pull the owner's OTHER vehicles into the invitee's export.
5. **The C151 async-tx footgun** applies to any multi-row share+notify write — validate before insert.
