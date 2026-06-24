# Vehicle Sharing — Tasks

> Backend-first per CLAUDE.md (schema → repository → routes/validation → backup → frontend eyes-on
> tail), exactly like trips/recurring/import. **T0 is a SIGN-OFF GATE — NOTHING builds until Angelo
> ratifies D1–D8 in `requirements.md`.** This is the highest-care feature in the backlog: every gate
> change widens cross-tenant access, so EVERY slice that touches a route ships its `cross-tenant-idor.test.ts`
> entries in the SAME cycle (the C108–C116 IDOR-audit discipline). One task per `feature` cycle, each
> independently verified via `bun run validate:local`.

## Phase 0 — sign-off (gates everything)
- [ ] **T0 — Angelo ratifies D1–D8** (requirements.md). In particular confirm: D1 (is vehicle-sharing the
      right horizon feature to build now, vs theming-engine / money-cents / trips — all specced + awaiting
      sign-off), D2 (invite by existing-user email only, no external invites in v1), D3 (viewer|editor
      levels), D4 (owner-only actions stay strict), D6 (existence-hiding 404-not-403), D7 (pending-invite
      backup re-creation), D8 (revoke-on-delete cascade). **BUILD UNBLOCKS only on explicit approval.**
      If Angelo prefers a different horizon feature, this spec is shelved (not discarded).

## Phase 1 — schema + access model (the data-safety core; land before any gate-widening)
- [ ] **T1 — Migration 0006 + schema.** Additive `vehicle_shares` table + the partial-unique active-share
      index + the two lookup indexes (design §1). +schema types. No backfill. Mirror `migration-0004.test.ts`:
      table exists, FKs cascade, partial-unique rejects a dup active share but allows re-invite after decline.
- [ ] **T2 — `utils/sharing.ts` access resolver.** `resolveVehicleAccess` + `requireVehicleRead` /
      `requireVehicleWrite` (design §2): owner via `vehicles.userId`; else the accepted share's level; else
      null → **404 (never 403)**. Pure-ish (db + ids in). Unit + HTTP-harness tested: owner→full, accepted
      viewer→read-only, accepted editor→read+write, pending/declined/revoked→no access, non-share third
      party→404. This is the ONE seam every gate change routes through.

## Phase 2 — share-management routes
- [ ] **T3 — `/api/v1/shares` router (owner side).** POST invite (`validateVehicleOwnership` + invitee
      lookup by email + the C151 validate-before-insert), GET `/granted`, PUT `:id` level-change, DELETE
      `:id` revoke. Each cross-tenant-idor.test.ts entry in the same cycle (non-owner invite/revoke denied).
- [ ] **T4 — invitee side.** GET `/received`, POST `:id/accept`, POST `:id/decline` (only
      `sharedWithId === acting`; accepted→self-remove). IDOR entries: a third party can't accept/decline
      someone else's invite.

## Phase 3 — gate-widening (ONE domain per cycle; each ships its IDOR entries)
- [ ] **T5 — expenses** read+write routes: `validateVehicleOwnership` → `requireVehicleRead/Write`.
      `GET /vehicles?include=shared` widens the fleet list to owner ∪ accepted-shared. IDOR: viewer-write
      denied, editor-other-vehicle denied.
- [ ] **T6 — odometer** read+write → the resolver; IDOR entries.
- [ ] **T7 — reminders** read+write → the resolver; IDOR entries.
- [ ] **T8 — insurance + analytics READ** → `requireVehicleRead`; IDOR entries. (Owner-only actions —
      delete vehicle, financing/purchase-price edit, share management — KEEP strict `validateVehicleOwnership`,
      verified denied for an editor.)

## Phase 4 — backup / restore (R7, NORTH_STAR #1)
- [ ] **T9 — `vehicle_shares` round-trip.** Join the table-coverage maps (both source-scan guards) +
      `validateReferentialIntegrity` (vehicleId→vehicles, owner/sharedWith→users). Owner export includes
      granted shares; the invitee export must NOT pull the owner's vehicle/shares (blast-radius test, §6.4).
      Round-trip: seed → export → wipe → restore → identical (D7 decides pending re-creation).

## Phase 5 — frontend (eyes-on tail; Playwright-gated → "code-complete, eyes-on pending")
- [ ] **T10 — `share-api.ts` client** (the C149/C163 service pattern) + types.
- [ ] **T11 — Share dialog** on the vehicle page (owner: email + level + current-shares list with
      revoke/level-change). Four-states + a11y + mobile.
- [ ] **T12 — "Shared with me"** section + pending-invite accept/decline; fleet cards badged
      "shared by <name>"; viewer sees NO edit affordances (mirror the `requireVehicleWrite` denial in UI).
- [ ] **T13 — Round-trip E2E** (`vehicle-sharing.meshclaw.e2e.ts`): owner invites → invitee accepts →
      invitee sees+edits (as editor) the shared vehicle's expenses → owner revokes → access gone. Self-cleaning.

## Phase 6 — DONE
- [ ] **T14 — Feature DoD:** backend + frontend `validate:local` green; `regress.sh` green; eyes-on
      screenshots of the share dialog + the "shared with me" surface + a viewer-mode vehicle (no edit
      affordances); the full IDOR sweep green across every widened domain.

## Guard-rails carried from the codebase
- **404-not-403** on no-access (the #80 enumeration-oracle lesson).
- **Owner-only actions stay strict** `validateVehicleOwnership` — `requireVehicleWrite` (editor) is NOT enough.
- **No slice is "done" without its `cross-tenant-idor.test.ts` entries** (the C108–C116 method) — widening
  cross-tenant access is the entire feature; an untested gate is a live IDOR.
- **C151 async-tx footgun:** validate before insert on any multi-row share+notify write.
- Shared-created expense rows are owner-`userId`-stamped and STAY on revoke/delete (real cost history).
