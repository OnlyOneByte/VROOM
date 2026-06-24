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
