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
  - [~] **T5b — expense read+write widening — UNBLOCKED (Angelo ruled option (a) owner-stamp + createdBy,
        2026-06-27).** The model is now in design.md §2.1 (the money-data-safety core). Decomposed into
        verified one-per-cycle slices, each shipping its `cross-tenant-idor.test.ts` entries:
    - [x] **T5b-0 — design.md §2.1 (the ratified model) + this decomposition (C91, 2026-06-27).** Mapped
          every userId-keyed read/write/backup site across expenses/odometer/reminders (3 scouts); wrote the
          owner-stamp + createdBy + read-by-vehicleId model + the getCurrentOdometer owner-scope fix + the
          build order into design.md. Confirmed the backup path is already owner-keyed end-to-end (C54) and
          the vehicleShares schema header already declares the owner-stamp intent → the migration realizes an
          already-documented decision. Docs-only (no source). NEXT slice: T5b-1.
    - [x] **T5b-1 — migration 0011 (additive `created_by`) (C92, 2026-06-27).** `ALTER TABLE expenses ADD
          created_by text REFERENCES users(id)` (nullable; NULL = legacy/self sentinel). db:generate produced
          a CLEAN single-ALTER — no destructive bundle this time (the 0010 snapshot healed the 0009 diff gap
          that caused the C48 bundle), snapshot + journal idx 11 written. Schema-derived backup paths (CSV +
          coerceRow) auto-carry it; added `createdBy` to the hand-maintained Sheets header array (the
          sheets-header-coverage drift guard fired + is now green). migration-0011 test: 4 cases (column
          exists, nullable, created_by stampable distinct from user_id [editor-on-shared case], additive/no
          __new_ scaffold). +createdBy:null in 3 Expense-literal test fixtures (tsc-required). Backend
          validate:local green (2051 pass [+4], 0 fail, all drift guards green). NEXT: T5b-2 expense WRITE.
    - [x] **T5b-2 — expense WRITE widening (single-expense routes) (C93, 2026-06-27).** POST/PUT/DELETE
          `/expenses/:id` flipped `validateVehicleOwnership`/`validateExpenseOwnership` →
          `requireVehicleWrite` (the resolver seam's FIRST production consumer — was tested-but-dormant).
          Owner-stamp realized: on create `userId = resolveVehicleOwnerId(vehicle)` + `createdBy = acting
          when acting !== owner else NULL` (self/legacy sentinel); PUT/DELETE load the row UNSCOPED (it is
          owner-stamped, so the old userId-scoped ownership check would 404 the editor's own edit) then gate
          on `requireVehicleWrite`. Hardened: `createdBy` omitted from the create input schema (server-set
          provenance, not forgeable); vehicle reassignment is SAME-OWNER-only (a cross-owner move would
          silently relocate cost between two users' books + break the userId==owner invariant); mileage-
          recheck + photo-cascade re-scoped to the OWNER's userId. IDOR sweep (cross-tenant-idor.test.ts
          +2): third-party-denied + viewer-write-denied + editor-other-vehicle-denied (all 404) and
          editor-owner-action-denied (an accepted editor still 404s on vehicle edit/delete, financing
          create, re-share — owner-only stays strict `validateVehicleOwnership`). +shared-expense-write.test.ts
          (5 cases): editor-create owner-stamp, owner-create self-NULL, editor PUT+DELETE, viewer-denied-untouched,
          cross-owner-reassign-rejected. Backend validate:local green (2058 pass [+7], 0 fail, drift guards green).
    - [ ] **T5b-2b — split-expense WRITE widening (`POST/PUT/DELETE /expenses/split`).** DEFERRED from T5b-2
          (WIP=1, one verified slice): the split path is a deeper rework — siblings span MULTIPLE vehicles
          (potentially different owners) and `createSiblings` stamps ONE `userId`, so owner-stamp per sibling
          is a repository-layer change + a product question (can an editor split a cost ACROSS a shared and an
          owned vehicle?). Currently SAFE — the split route gates on `assertVehiclesOwned` (must own EVERY
          vehicle), so a shared editor is cleanly denied (no IDOR, pinned by the existing C115 split IDOR
          entry). Resume after T5b-3.
    - [x] **T5b-3 — expense READ widening (list/single/summary) (C94, 2026-06-27).** The three per-vehicle
          reads — GET `/expenses?vehicleId`, GET `/expenses/:id`, GET `/expenses/summary?vehicleId` — flipped
          `validateVehicleOwnership`/`validateExpenseOwnership` → `requireVehicleRead` (owner | accepted
          viewer | accepted editor | 404). Because shared rows are OWNER-stamped (T5b-2), the per-vehicle
          query is scoped to `resolveVehicleOwnerId(vehicleId)` (the owner whose books back the vehicle) — so
          a shared invitee sees that vehicle's owner-stamped rows; the owner+vehicleId pin means the owner
          cannot leak OTHER vehicles through it. CROSS-FLEET reads (no vehicleId) STAY acting-user-owned-only
          (the shared vehicle's costs belong to the OWNER's dashboard → no double-count, no foreign rows in
          the invitee's all-vehicles list). GET /:id loads UNSCOPED then requireVehicleRead (existence-hiding
          404 for a stranger). Removed the now-dead validateExpenseOwnership import. +shared-expense-read.test.ts
          (5 cases: viewer reads list/single/summary; cross-fleet isolation both sides; stranger-404;
          pending-not-yet-accepted-404; owner-self-unchanged) + cross-tenant-idor.test.ts (+1: third-party
          per-vehicle reads denied + viewer-reads-but-cannot-write). Backend validate:local green (2064 pass
          [+6], 0 fail, drift guards green).
    - [ ] **T5b-3b — expense EXPORT (CSV) READ widening (`GET /expenses/export`).** DEFERRED from T5b-3
          (WIP=1): the export still uses strict `validateVehicleOwnership` + builds a vehicleName map / currency
          from `vehicleRepository.findByUserId(acting)` + `preferencesRepository.getByUserId(acting)`. Widening it
          to a shared vehicle needs the owner-scoped findAll AND the OWNER's vehicle-name/currency context (an
          invitee exporting the shared vehicle should see the owner's vehicle label + the row currency) — a
          distinct wrinkle from the JSON reads. Currently SAFE (an invitee export of a shared vehicleId 404s,
          same as pre-T5b). Resume after T6, or fold into the T8 read-family.
- [x] **T6 — odometer read+write widening (C95, 2026-06-27).** The odometer analogue of T5b-2+T5b-3 in ONE
      slice (tighter surface than expenses — no createdBy migration, no split path). All five routes flipped
      `validateVehicleOwnership`/`validateOdometerOwnership` → `requireVehicleRead`/`requireVehicleWrite`.
      WRITE: POST owner-stamps `userId = resolveVehicleOwnerId(vehicle)` (an editor's reading rides the OWNER's
      books / getCurrentOdometer / mileage); PUT/DELETE load the entry UNSCOPED (owner-stamped → the old
      userId-scoped check would 404 the editor's edit) then gate on requireVehicleWrite; mileage-recheck +
      photo-cascade re-scoped to the OWNER's userId. READ: list/history gate via requireVehicleRead + query
      the OWNER's books (resolveVehicleOwnerId); GET /entry/:id loads UNSCOPED then requireVehicleRead
      (existence-hiding 404). **NO createdBy column** — odometer rows are not money rows (only the expenses
      provenance migration 0011 added one), so the owner-stamp is via userId alone (design §2.1 names T6 as
      owner-SCOPE, not owner-stamp+createdBy). **getCurrentOdometer owner-scope (rule 4): the FUNCTION already
      scopes by whatever userId it is passed (correct); its 4 callers (reminders routes ×2, trigger-service via
      reminder.userId, vehicle-detail GET) all currently pass the OWNER's id because those routes are still
      owner-only-gated (T7/T8 surfaces) — so the call-site threading lands with T7/T8 when those widen; touching
      them now would break WIP=1.** +shared-odometer.test.ts (4 cases: editor-create owner-stamp on the RAW
      stored row, viewer reads list/history/entry, editor PUT+DELETE userId-stable, viewer-denied-untouched) +
      cross-tenant-idor.test.ts (+1: third-party read+write denied, viewer-reads-but-cannot-write). NOTE:
      validateOdometerOwnership is now a DEAD export (its last caller was this file) — left for an arch cleanup
      cycle (removing it touches validation.ts + a test). Backend validate:local green (2069 pass [+5], 0 fail,
      drift guards green).
- [x] **T7 — reminder per-vehicle READ widening (C96, 2026-06-27).** `GET /reminders?vehicleId=<shared>`
      flipped its flat `findByUserId(acting)` scope → `requireVehicleRead(vehicleId, acting)` + list the
      OWNER's reminders for that vehicle (`resolveVehicleOwnerId` → `findByUserId(owner, {vehicleId})`; the
      junction INNER-JOIN pins it to exactly that vehicle's reminders, so the owner cannot leak reminders on
      OTHER vehicles). CROSS-FLEET list (no vehicleId) STAYS acting-user-owned (a shared vehicle's reminders
      live on the owner's surface → the invitee sees them only via ?vehicleId; no foreign rows in the
      all-reminders list). +shared-reminder-read.test.ts (6 cases: viewer+editor list the shared vehicle's
      reminders, cross-fleet isolation both sides, stranger-404, pending-not-accepted-404, AND write-stays-
      owner-only) + cross-tenant-idor.test.ts (+1: third-party per-vehicle list denied + editor-reads-but-
      write-still-owner-only). Backend validate:local green (2076 pass [+7], 0 fail, drift guards green).
    - [ ] **T7b — reminder WRITE widening (POST/PUT/DELETE /reminders + mark-serviced).** DEFERRED from T7
          (WIP=1): a reminder is userId-OWNED with a MULTI-vehicle junction + auto-materializes expense rows,
          so the owner-stamp carries genuine forks the single-vehicle expense/odometer model did not: (a) which
          owner stamps a reminder spanning vehicles of DIFFERENT owners? (b) may an editor create a reminder
          spanning a shared + an owned vehicle (and would its materialized expenses then split across two
          users' books)? (c) the getCurrentOdometer caller-threading in resolveMileageFields/mark-serviced
          (reminders/routes.ts) must pass the OWNER's id once writes widen — currently passes acting (still
          owner-only-gated, so correct today). Likely resolves to "editor may only create a reminder whose
          vehicle set is entirely ONE owner's" + owner-stamp userId = that owner. Currently SAFE — the WRITE
          paths keep strict validateVehicleIdsOwned (a shared editor is cleanly denied, pinned by the T7 write
          IDOR entry). Resume after T8, or escalate the multi-owner fork to Angelo if it is not clean-cut.
- [~] **T8 — insurance + analytics READ → `requireVehicleRead`.** SPLIT into T8a (analytics, DONE C97) +
      T8b (insurance, next). Owner-only actions (delete vehicle, financing/purchase-price edit, share
      management) KEEP strict `validateVehicleOwnership` — verified denied for an editor (the T5b-2
      editor-owner-action IDOR entry).
    - [x] **T8a — per-vehicle analytics READ widening (C97, 2026-06-27).** The six vehicle-scoped analytics
          routes (fuel-stats, fuel-advanced, fuel-efficiency, vehicle-health, vehicle-tco, vehicle-expenses)
          flipped `validateVehicleOwnership` → a shared `resolveVehicleScope(vehicleId, acting)` helper
          (requireVehicleRead → owner | viewer | editor | 404, then returns the OWNER's id). Per-vehicle
          analytics scope expenses by (vehicleId, userId) and shared rows are OWNER-stamped (T5b-2), so the
          query runs against the OWNER's books (an invitee's own id would yield an empty chart); the
          vehicleId+ownerId pin means only THAT vehicle's rows surface. CROSS-FLEET analytics
          (summary/quick-stats/cross-vehicle/financing/insurance/year-end — no vehicleId) STAY
          acting-user-scoped, untouched. +shared-analytics-read.test.ts (6 cases: viewer+editor read all six,
          stranger-404 all six, pending-404, TCO surfaces the owner-stamped expense [owner-scope not empty],
          owner-self-unchanged) + cross-tenant-idor.test.ts (+1: third-party denied all six). Backend
          validate:local green (2083 pass [+7], 0 fail, drift guards green).
    - [ ] **T8b — insurance per-vehicle READ widening (`GET /insurance/vehicles/:vehicleId/policies`).**
          DEFERRED from T8 (WIP=1): a wrinkle the analytics/expense reads did not have — `findByVehicleId`
          returns the WHOLE policy (incl. its OTHER terms/vehicles' coverage), so widening it to a shared
          invitee could leak the owner's coverage on vehicles NOT shared with them (a multi-vehicle policy
          spanning shared + unshared cars). The fix likely filters the returned terms/coverage to the shared
          vehicle only — a repository-shape change, not a one-line gate flip. Plus the analytics `/insurance`
          cross-fleet route is acting-user-scoped (correct, no change). Currently SAFE — the per-vehicle
          policies route keeps strict `validateVehicleOwnership` (an invitee 404s). Resume after T12b-3, or
          escalate the leak-scope decision to Angelo if the per-vehicle coverage filter is not clean-cut.

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
    - [x] **T12b-2 — fleet widening + "shared by" badge (C58, 2026-06-27).** Wired
          `getVehicles({includeShared:true})` (appends `?include=shared`, optional arg → every existing caller
          unchanged) + added `sharedAccess?: SharedAccess` to the FE `Vehicle` type + threaded `sharedBy` through
          the dashboard `vehicleOverviews` projection + `VehicleCarousel`'s local `VehicleOverview` → a shared
          card shows a top-LEFT "Shared by `<name>`" secondary Badge (Users icon, mirrors + never collides with
          "Financed"). KEY decision: stats cards (Total Vehicles / Active Financing) + expense totals are
          owner-scoped on the backend, so a shared vehicle in those counts would contradict the dollar figures —
          added an `ownedVehicles` derived + pointed stats and the log-fillup preselect at it; only the fleet
          carousel widened (gate → `vehicleOverviews.length` so a shared-only fleet still shows). EYES-ON: seeded
          an accepted share, shot dashboard desktop + mobile → Subaru Outback appears as a 3rd fleet card badged
          "Shared by Alice Rivera", Total Vehicles stays 2 (owned-only), no overflow, zero console errors. FE
          validate:local green (svelte-check 0 err, build, 1325 pass).
    - [ ] **T12b-3 — viewer-sees-no-edit on the [id] page — BLOCKED (folds into T5b/T8).** Scouted (C58): the
          `[id]` page loads via `getVehicle(id)`, the OWNER-only single-vehicle path — it does NOT pass
          `?include=shared` and `vehicle.sharedAccess` is always undefined there, AND a non-owner shared-read
          would currently 404 (no `requireVehicleRead` on `GET /vehicles/:id` yet). So gating the edit
          affordances (VehicleInfoCard edit, odometer/finance/photo mutates, the Share button) by level needs the
          single-vehicle GET to FIRST widen to shared-read + return the access level — that is the T8 read-widen
          family on the `requireVehicleRead` seam, gated on Angelo's T5b ruling. There is also zero gating infra
          today (no `canEdit`/level prop on VehicleHeader or any child — each affordance gates at its own call
          site). Resume when T5b/T8 land the backend read-widening + level on the detail GET.
- [x] **T13 — Lifecycle round-trip (C59, 2026-06-27).** Shipped as a TRACKED HTTP-harness round-trip
      (`shared-fleet-list.test.ts`, +2 tests) NOT an untracked browser e2e — rationale: (a) GUIDE standing
      truth "source-scan/harness guards > untracked e2e for merge survival" (a `*.meshclaw.e2e.ts` is gitignored
      → vanishes on merge); (b) a browser spec cannot set up the OWNER side (auth is OAuth-only, no HTTP signup
      — the second user must be DB-seeded, which the harness does); (c) the FE render legs are already
      eyes-on-verified (T12b-1 drove Accept, T12b-2 shot the "shared by" badge). Walks the exact T13 sequence:
      owner invites → invitee accepts → vehicle APPEARS annotated in the invitee fleet → owner REVOKES →
      vehicle is GONE — closing the **D8 revoke→gone-from-fleet leg that NO prior test pinned** (shares-routes
      pinned only revoke→slot-freed). +a reversibility test (re-invite after revoke, re-accepted → vehicle
      returns with the new grant level). Backend validate:local green (2047 pass, +2).
      > NOTE: the "invitee EDITS the shared vehicle's expenses" leg of the original T13 wording is the T5b
      > editor-WRITE path — still gated on Angelo's expense-model ruling, so T13 pins the read+lifecycle legs
      > that ARE shipped; the edit-round-trip leg lands with T5b.

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
