# Vehicle Sharing — Tasks

> Backend-first per CLAUDE.md (schema → repository → routes/validation → backup → frontend eyes-on
> tail), exactly like trips/recurring/import. **T0 is a SIGN-OFF GATE — NOTHING builds until Angelo
> ratifies D1–D8 in `requirements.md`.** This is the highest-care feature in the backlog: every gate
> change widens cross-tenant access, so EVERY slice that touches a route ships its `cross-tenant-idor.test.ts`
> entries in the SAME cycle (the C108–C116 IDOR-audit discipline). One task per `feature` cycle, each
> independently verified via `bun run validate:local`.

## Phase 0 — sign-off (gates everything)
- [x] **T0 — Angelo ratified D1–D8 (2026-06-27).** All as RECOMMENDED in requirements.md: D2 per-vehicle,
      D3 viewer|editor, D4 existing-user-email invite, D5 explicit accept/decline, D6 acting-user stamp
      (v1), D7 backup re-creates **ACCEPTED grants only** (NOT pending invites — Angelo's explicit pick),
      D8 revoke/delete cascade drops the share but KEEPS shared-created cost rows. D1 = yes, build now.
      **BUILD UNBLOCKED.** (Slack ratification 2026-06-27; the gate is cleared, Phase 1+ proceeds.)

## Phase 1 — schema + access model (the data-safety core; land before any gate-widening)
- [x] **T1 — Migration 0010 + schema (C48, 2026-06-27).** Additive `vehicle_shares` table + partial-unique
      active-share index + 2 lookup indexes (design §1). +schema types (VehicleShare/NewVehicleShare). IDs are
      text/cuid2 (design said integer — CORRECTED to live schema: users.id + vehicles.id are text). Migration
      number is **0010** not 0006 (0006-0009 landed since the draft). CAUGHT + STRIPPED a data-loss footgun:
      db:generate bundled destructive rebuilds of 6 existing tables (drizzle diffing off the 0009 snapshot gap
      — money-cents left REAL affinity + wrote no snapshot); kept only the additive vehicle_shares SQL, kept
      the regenerated snapshot (records integer affinity, fixes the drift for future migrations). migration-0010
      test (7 cases): table+indexes exist, all 3 FKs cascade, partial-unique rejects dup-active but allows
      re-invite after decline/revoke, additive (existing rows survive, no __new_ scaffold). Backup guard: parked
      vehicle_shares in EXCLUDED_BY_DESIGN with a pending-T9 marker. Both validate:local green.
- [x] **T2 — `utils/sharing.ts` access resolver (C49, 2026-06-27).** `resolveVehicleAccess` +
      `requireVehicleRead` (owner|viewer|editor or 404) / `requireVehicleWrite` (owner|editor or 404 — viewer
      DENIED with the same 404, no capability oracle). Owner via `vehicles.userId` (the load-bearing truth, NOT
      the denormalized share.ownerId); else the ACCEPTED share level; else null → 404 never 403. Optional db
      handle for testability, singleton default for routes. 13-case unit test drives the real functions vs a
      migrated throwaway DB (the full owner/viewer/editor × pending/accepted/declined/revoked × stranger/
      nonexistent matrix + a lying-ownerId-no-elevation guard). NO gate-widening yet (T3+ wire routes). Green.

## Phase 2 — share-management routes
- [x] **T3 — `/api/v1/shares` router (owner side) (C50, 2026-06-27).** New `api/shares/` repository
      (VehicleShareRepository: findActiveForVehicleAndUser dup-gate, findByOwner list, findByIdAndOwner +
      findByIdAndSharedWith scoped reads) + router mounted at /api/v1/shares: POST invite
      (validateVehicleOwnership → invitee-by-email lookup [D4 existing-user-only] → self-invite reject →
      dup-active 409, all BEFORE the insert per C151), GET /granted, PUT :id level-change, DELETE :id revoke
      (status→revoked, frees the partial-unique slot for re-invite). Owner-only throughout (strict
      validateVehicleOwnership / ownerId-scoped reads → 404 never 403). Tests: shares-routes.test.ts (10
      cases, happy + reject paths) + a `shares` entry in cross-tenant-idor.test.ts (A cannot invite to B's
      vehicle nor change/revoke a share B granted; B's share untouched). validate:local green (2026 pass).
- [x] **T4 — invitee side (C51, 2026-06-27).** GET `/received` (pending+accepted shares TO me),
      POST `:id/accept` (pending→accepted; non-pending→409), POST `:id/decline` (pending→declined OR
      accepted→self-remove; frees the active slot for re-invite). ALL scoped to `sharedWithId === acting`
      → a non-invitee gets 404 (existence-hiding). Repo: findReceivedByUser. Tests: +6 invitee cases in
      shares-routes.test.ts (received/accept/decline/self-remove/non-pending-409/404) + an IDOR entry (the
      OWNER, a non-invitee, cannot accept/decline the invite it sent; the real invitee can). Green (2032 pass).

## Phase 3 — gate-widening (ONE domain per cycle; each ships its IDOR entries)
- [~] **T5 — SPLIT into T5a (DONE C52) + T5b (ESCALATED to Angelo, Slack ts 1782524200).**
  - [x] **T5a — `GET /vehicles?include=shared` fleet-list widening (C52, 2026-06-27).** Read-only +
        additive: an ACCEPTED share appends the owner's vehicle to the invitee's fleet, annotated
        `sharedAccess { level, sharedBy }`; owner ∪ accepted-shared. Repo: vehicleRepository.findByIds +
        vehicleShareRepository.findAcceptedAccessForUser (owner-name join, accepted-only). 5 tests:
        accepted appears+annotated, pending/declined/non-shared do NOT appear, owned rows carry no
        annotation. Green (2037 pass).
  - [ ] **T5b — expense read+write widening — BLOCKED on Angelo's architecture call.** The spec's
        "flip validateVehicleOwnership → requireVehicleRead/Write" does NOT work for expenses: the whole
        expense read/write/backup/TCO model is `expenses.userId`-keyed, NOT vehicleId-keyed. A naive flip
        (a) returns ZERO rows for a shared editor (findPaginated({userId})) and (b) would stamp an editor's
        created expense with the EDITOR's userId → it vanishes from the owner's backup/TCO + double-counts.
        D6-v1 (acting-user stamp) really means: stamp shared-created rows userId=OWNER + add a `createdBy`
        column (migration 0011) + rework expense reads to resolve shared-vehicle access by vehicleId. Money
        table + migration + highest cross-tenant risk → escalated (options: owner-stamp+createdBy / defer
        editor-write to v2 / other). Build resumes on the ruling; design.md gets the chosen model first.
- [ ] **T6 — odometer** read+write → the resolver; IDOR entries. **BLOCKED — folds into the T5b ruling
      (C53 verified): odometer is userId-stamped on create + userId-scoped on every read
      (findByVehicleIdPaginated/getHistory/getCurrentOdometer all AND eq(userId), validateOdometerOwnership
      checks entry.userId). Same model problem as expenses → same fix → same ruling.**
- [ ] **T7 — reminders** read+write → the resolver; IDOR entries. **BLOCKED — folds into the T5b ruling
      (C53 verified): a reminder is a userId-OWNED row (reminders.userId) with a vehicle JUNCTION, not a
      vehicleId-owned row; widening it to a shared editor is the same userId-vs-vehicleId rework. Same ruling.**
- [ ] **T8 — insurance + analytics READ** → `requireVehicleRead`; IDOR entries. (Owner-only actions —
      delete vehicle, financing/purchase-price edit, share management — KEEP strict `validateVehicleOwnership`,
      verified denied for an editor.)

## Phase 4 — backup / restore (R7, NORTH_STAR #1)
- [x] **T9 — `vehicle_shares` round-trip (C54, 2026-06-27).** Wired the table end-to-end through BOTH
      backup paths: config maps (TABLE_SCHEMA_MAP/FILENAME_MAP/OPTIONAL) + BackupData/ParsedBackupData types
      + createBackup query (ZIP) + google-sheets-service (SHEET_HEADERS/SHEET_NAMES + export query/fan-out +
      readback) + validateReferentialIntegrity (validateShareRefs: vehicleId→vehicles, ownerId→creator;
      sharedWithId deliberately NOT validated — invitee not in backup) + validateUniqueConstraints
      (active-share dup) + restore FK-ordered insert + conflict-probe + ImportSummary (both paths). Moved
      vehicle_shares OUT of EXCLUDED_BY_DESIGN (T1 park discharged). DATA-SAFETY decisions: D7 = export
      ACCEPTED grants only (createBackup filters status='accepted'); §6.4 blast-radius = ownerId scope so an
      invitee never exports the owner's shares; #127-safe = restore re-stamps ownerId to importer + SKIPS a
      grant whose invitee user is absent (cross-instance) rather than FK-aborting the whole restore. 5-case
      round-trip test (round-trip / D7 accepted-only / invitee-blast-radius / cross-instance-skip). All 4
      drift guards green. validate:local green (2042 pass).

## Phase 5 — frontend (eyes-on tail; Playwright-gated → "code-complete, eyes-on pending")
- [x] **T10 — `share-api.ts` client + types (C53, 2026-06-27).** Pulled FORWARD (out of phase order) as
      the one cleanly-unblocked sharing slice while T5b-T8 await Angelo's expense-model ruling — it depends
      only on the stable T3/T4 routes. `types/share.ts` (VehicleShare, ShareLevel/Status, CreateShareRequest,
      SharedAccess) + barrel export; `services/share-api.ts` (the C149/C163 pattern): owner invite/listGranted/
      changeLevel/revoke + invitee listReceived/accept/decline (thin envelope pass-throughs; no money fields →
      no transform). 7-case test mirrors reminder-api.test (mocked apiClient, asserts URL+body+passthrough).
      Frontend validate:local green (svelte-check 0 err, build, 1325 pass). No UI yet (T11/T12) → no eyes-on.
- [x] **T11 — Share dialog (C55, 2026-06-27).** ShareVehicleDialog.svelte on the vehicle [id] page (a
      "Share" button in the header opens it): invite-by-email + level Select, + the current-shares list
      for THIS vehicle (client-filtered from shareApi.listGranted) with per-row level-change Select +
      revoke, toast on each action surfacing the backend's specific message. Four-states (loading skeleton
      / error+retry / empty "Not shared yet" / populated) + a11y (labels, aria-label on row controls).
      EYES-ON VERIFIED: booted servers, shot the vehicle page (Share button present in header) + drove the
      dialog open (CLICK_SELECTOR) → Read both PNGs: dialog renders correctly with form + empty-state, zero
      console errors. Frontend validate:local green (svelte-check 0 err, build, 1325 pass).
- [~] **T12 — SPLIT into T12a (DONE C56) + T12b (FE UI, next).** The invitee surface needs a human label
      per row, but `GET /received` returned bare share rows (FK IDs only) and T5a's fleet widening is
      ACCEPTED-only — so a still-PENDING invite could not resolve its vehicle/owner. Backend-first split:
  - [x] **T12a — enrich `GET /shares/received` (C56, 2026-06-27).** `findReceivedByUser` now inner-joins
        vehicles + users and returns a `ReceivedShare` (raw row + `vehicleName` [nickname else "year make
        model"] + `sharedBy` [owner displayName, matching T5a `sharedAccess.sharedBy`]). Join columns are the
        SHARE's own vehicle/owner, where-clause stays `sharedWithId`-scoped → no cross-tenant widening. FE
        `ReceivedShare` type + `listReceived(): Promise<ReceivedShare[]>` in lockstep. Tests: +2 enrichment
        cases (pending row label = "2021 Honda Civic" + `sharedBy` = owner not invitee; nickname wins) + an
        IDOR entry (the C108-C116 discipline: `/received` stays invitee-scoped through the join). Both
        validate:local green (BE 2045 pass [+3], FE 1325 pass, svelte-check 0 err).
  - [~] **T12b — SPLIT into T12b-1 (invites card, DONE C57) + T12b-2 (fleet widening, next).**
    - [x] **T12b-1 — "Shared with you" pending-invites card (C57, 2026-06-27).** `SharedWithMeCard.svelte`
          on the dashboard (below the stats cards): a self-fetching, self-hiding notification widget listing
          PENDING invites via the T12a-enriched `GET /received` — each row shows `vehicleName` + an
          Editor/Viewer badge + "Shared by `sharedBy`" + Accept/Decline (`shareApi.accept`/`decline`, toast the
          backend message via ApiError). Renders nothing unless an invite is pending or the load failed
          (compact retry card) → the common dashboard is unchanged. Mounted OUTSIDE the `totalVehicles>0` gate
          (a new user can be invited before owning anything); accepting fires `onAccepted` to refresh the
          dashboard. EYES-ON VERIFIED (C230 drive-the-action): seeded a pending share, shot desktop + mobile
          (renders both, no overflow), DROVE Accept → DB flipped pending→accepted + toast + card self-hid +
          fleet refreshed; confirmed plain /vehicles does NOT leak the shared vehicle; zero console errors. FE
          validate:local green (svelte-check 0 err, build, 1325 pass).
    - [ ] **T12b-2 — fleet widening + "shared by" badge + viewer-no-edit (eyes-on).** Wire
          `getVehicles({includeShared:true})` (append `?include=shared`) + add `sharedAccess?: SharedAccess` to
          the FE `Vehicle` type + thread it through the dashboard `vehicleOverviews` projection +
          `VehicleCarousel`'s local `VehicleOverview` → badge a shared card "shared by `<name>`" (mirror the
          "Financed" Badge). Viewer-level shared vehicles show NO edit affordances on the [id] page (mirror the
          `requireVehicleWrite` 404 denial in UI). Eyes-on: shot the dashboard with an accepted shared vehicle
          present + a viewer-mode [id] page.
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
