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
          GUARD FOLLOW-UP (C104): +2 provenance forge-vector tests pinning that a client-supplied `createdBy`
          in the POST body is IGNORED on BOTH paths (owner-create → stays NULL; editor-create → stamped the
          acting editor, never the forged id) — so a future schema refactor that reopened the forge fails here.
    - [x] **T5b-2b — split-expense WRITE widening (`POST/PUT/DELETE /expenses/split`) (C473, 2026-06-27).**
          The deeper rework, resolved as a direct corollary of the ratified §2.1 model (NOT re-escalated —
          the product fork was clean-cut). New `requireSplitWriteAccess` (routes.ts) gates EVERY config
          vehicle through the share seam (`requireVehicleWrite` per vehicle, owner|editor|404) and enforces
          the **single-owner invariant**: because a split group carries ONE `userId` across all siblings, the
          vehicle set must resolve to one owner — a cross-owner split (shared + owned, or two owners) is
          rejected (ValidationError 400). Every sibling is owner-stamped `userId=OWNER` + `createdBy=acting
          editor` (NULL when owner authors). createSiblings threads `createdBy`; createSplitExpense/
          updateSplitExpense take `ownerId`/`createdBy` (default self/NULL → non-shared byte-identical).
          PUT/DELETE/GET load the group UNSCOPED via new `getSplitGroupAccessInfo` then authorize on the
          seam (write to mutate; read for GET — a viewer may read, not write); all repo reads/writes scope to
          the resolved owner id. SHIPPED its IDOR entries same cycle: new shared-split-write.test.ts (8 cases:
          editor single+multi same-owner stamp, owner self-split NULL, cross-owner reject, viewer-denied,
          editor PUT/DELETE, viewer GET) + a T5b-2b entry in cross-tenant-idor.test.ts (viewer reads-not-
          writes, cross-owner denied, no leak). validate:local green (2109 pass [+8], 0 fail). Commit 16693c1.
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
    - [x] **T5b-3b — expense EXPORT (CSV) READ widening (C101, 2026-06-27).** `GET /expenses/export` flipped
          `validateVehicleOwnership` → `requireVehicleRead` (owner | viewer | editor | 404) + scopes a
          per-vehicle export to the OWNER's books (resolveVehicleOwnerId — rows are owner-stamped). The wrinkle
          the JSON reads lacked, all resolved cleanly: (a) the vehicle-NAME column resolves from the OWNER's
          fleet (the acting invitee's findByUserId lacks the shared vehicle → fetch it via findByIds[vehicleId],
          merged into the name map; never "Unknown Vehicle"); (b) CURRENCY stays the ACTING user's preference
          (they download their own file in their own locale); (c) a CROSS-FLEET export (no vehicleId) stays
          acting-user-scoped (a shared vehicle's rows belong to the owner's export, not the invitee's
          all-vehicles dump). Removed the now-DEAD validateVehicleOwnership import (the export was its last
          caller in this file). +4 cases in shared-expense-read.test.ts (viewer exports owner-stamped rows + the
          owner vehicle name; stranger-404; cross-fleet isolation both sides; owner-self-unchanged) +
          cross-tenant-idor.test.ts (third-party export denied + viewer-can-export added to the T5b-3 entry).
          Backend validate:local green (2097 pass [+4], 0 fail, drift guards green). **The backend READ-widening
          family is now COMPLETE across all 7 read surfaces** (vehicles GET, expense list/single/summary/EXPORT,
          odometer, reminders, analytics, insurance).
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
      cross-tenant-idor.test.ts (+1: third-party read+write denied, viewer-reads-but-cannot-write). Backend
      validate:local green (2069 pass [+5], 0 fail, drift guards green). FOLLOW-UP (C102, DONE): the T6 widening
      made `validateOdometerOwnership` a dead export — removed it + its orphaned odometerRepository/OdometerEntry
      imports from validation.ts (behavior-preserving; the 404 paths stay covered by update-route.test.ts + the
      IDOR sweep).
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
    - [x] **T7b — reminder WRITE widening (POST/PUT/DELETE /reminders + mark-serviced) (C474, 2026-06-27).**
          The last gated slice — resolved clean-cut (NOT escalated), exactly as the note predicted: the three
          forks all collapse to "an editor may write a reminder whose vehicle set is entirely ONE owner's,
          owner-stamp userId = that owner." New `requireReminderVehiclesWrite` (routes.ts) gates EVERY junction
          vehicle through the share seam (`requireVehicleWrite` per vehicle) + enforces the single-owner
          invariant (cross-owner → ValidationError 400). The reminder is stamped `userId=OWNER`; (a)+(b) are
          answered by rejecting a cross-owner set, and (c) resolves FOR FREE — the trigger-service already
          materializes expenses + reads getCurrentOdometer under `reminder.userId`, so owner-stamping the
          reminder routes every downstream effect (materialized rows, odometer scope, backup/TCO) to the owner;
          resolveMileageFields/mark-serviced/clearSource/markServiced now pass the resolved ownerId. PUT/DELETE/
          mark-serviced load UNSCOPED via new `reminderRepository.findByIdWithVehicles` then authorize on the
          seam (reminders have NO createdBy column → owner-stamp is userId-only). SHIPPED its IDOR entries same
          cycle: new shared-reminder-write.test.ts (6 cases: editor create owner-stamp, editor expense-reminder
          materializes onto OWNER books via /trigger, owner self unchanged, cross-owner rejected, editor PUT/
          mark-serviced/DELETE, viewer-denied-all) + the T7 read test's write-deny flipped to allow-editor/
          deny-viewer + a rewritten cross-tenant-idor reminder entry (third-party denied, viewer reads-not-
          writes, editor writes owner-stamped, cross-owner rejected). validate:local green (2115 pass, 0 fail).
          Commit 72792b2.
- [x] **T8 — insurance + analytics READ → `requireVehicleRead` (DONE: T8a C97 + T8b C98).** Owner-only
      actions (delete vehicle, financing/purchase-price edit, share management) KEEP strict
      `validateVehicleOwnership` — verified denied for an editor (the T5b-2 editor-owner-action IDOR entry).
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
    - [x] **T8b — insurance per-vehicle READ widening + blast-radius (C98, 2026-06-27).**
          `GET /insurance/vehicles/:vehicleId/policies` flipped `validateVehicleOwnership` →
          `requireVehicleRead` (owner | viewer | editor | 404). The flagged wrinkle was REAL +
          clean-cut (no escalation needed): `findByVehicleId` returns the WHOLE policy (all terms + the
          full termVehicleCoverage junction + vehicleIds deduped across ALL terms), so a NON-owner would
          see the owner's OTHER vehicles. Applied design §6.4 blast-radius via a pure `narrowPolicyToVehicle`
          helper: for a non-owner, drop terms not covering the shared vehicle + filter coverage rows + reduce
          vehicleIds to just it; the OWNER (access.role==='owner') gets the full policy UNCHANGED (narrows only
          a shared invitee's view, never the owner's — behavior-preserving for the existing owner path). The
          analytics `/insurance` cross-fleet route stays acting-user-scoped (untouched). +shared-insurance-read.test.ts
          (5 cases: multi-vehicle policy narrowed for a viewer [no leak of the other vehicle], OWNER sees the
          full policy, a term covering ONLY the other vehicle is dropped, stranger-404, pending-404) +
          cross-tenant-idor.test.ts (+1: third-party per-vehicle policies list denied). Backend validate:local
          green (2089 pass [+6], 0 fail, drift guards green).

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
      GUARD FOLLOW-UP (C105): +created-by-roundtrip.test.ts (2 cases) — the T5b-1 `expenses.created_by`
      provenance column (migration 0011) is schema-derived through coerceRow but had NO round-trip test;
      NORTH_STAR #1 (no silent loss) + the owner-stamp model both depend on it surviving export→wipe→restore.
      Pins: an editor-authored shared expense keeps user_id=OWNER AND created_by=editor byte-for-byte; an
      owner-self expense keeps created_by NULL (not coerced to "" or 0 by coerceRow). Merge-surviving.

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
    - [~] **T12b-3 — viewer-sees-no-edit on the [id] page — SPLIT into T12b-3a (BE, DONE C99) + T12b-3b (FE
          eyes-on, next).** The C58 block (T5b/T8 must land first) is now CLEARED — the read-widening family is
          fully shipped (T5b-3/T6/T7/T8) and the resolver seam is the production gate.
      - [x] **T12b-3a — GET /vehicles/:id shared-read + level annotation (C99, 2026-06-27).** The single-vehicle
            GET widened from owner-only (`findByIdWithAccess` scopes to `vehicles.userId` → an invitee 404'd) to
            the resolver seam: `resolveVehicleAccess(id, acting)` (owner | viewer | editor | null→404,
            existence-hiding), then load the row (owner via findByIdWithAccess, shared invitee via findByIds[id]
            with access already proven) and attach a `sharedAccess { level, sharedBy }` annotation for a
            NON-owner — the SAME shape the `?include=shared` fleet list emits, so the FE detail page can gate edit
            affordances by `vehicle.sharedAccess?.level`. The OWNER response is unchanged (no sharedAccess). +4
            cases in shared-fleet-list.test.ts (viewer/editor annotated, owner-no-annotation, stranger+pending
            both 404). Backend validate:local green (2093 pass [+4], 0 fail). NOTE: the existing GET-vehicle IDOR
            entry still passes (a non-shared third party 404s — the widening grants ONLY accepted shares).
      - [x] **T12b-3b — FE: gate the [id] edit affordances by level (C100, 2026-06-27, eyes-on).** Derived two
            capabilities on the [id] page from `vehicle.sharedAccess`: `isOwner` (no annotation → owned) and
            `canWrite` (owner OR editor). Gated every affordance by call site: Share button + dialog (isOwner),
            VehicleInfoCard edit (isOwner prop), VehiclePhotoCarousel upload/delete/set-cover (isOwner prop),
            FinanceTab → NextPaymentCard Record/Change-payment (isOwner prop), CSV export (isOwner), the empty-state
            Add-Expense + FAB (canWrite), ExpensesTable Edit links + delete (canWrite prop — delete suppressed by
            nulling onDelete so all 4 `{#if onDelete}` gates hide), OdometerTab Add/Edit/Delete (canWrite prop).
            All props default true so every existing owner call site is unchanged. EYES-ON (C230 drive-the-view):
            booted servers, seeded an accepted VIEWER share to a second user + minted their session, shot the [id]
            page as the viewer → confirmed Share/edit/photos chrome ABSENT. The shot SURFACED a real gap: the
            InsuranceTab was ungated (showed Add-Policy/edit/renew/file-claim + "insurance policy not found" errors
            — T8b widened only the per-vehicle policies LIST, not the claims sub-reads), so gated the whole tab +
            its lazy-load to `isOwner` (a read-only shared insurance view is deferred as T12b-3c). FE validate:local
            green (svelte-check 0 err, build, 1327 tests). The viewer-session backend read is verified 200 via
            direct API (curl); the re-shot to confirm the insurance fix flaked on a known shot-harness cookie
            artifact (the FIRST shot rendered + proved the gating; the fix is a trivial `&& isOwner` mirror of the
            shot-verified Share/edit gating). The backend enforces every denial regardless — this is
            defense-in-depth UX.
      - [~] **T12b-3c — read-only shared INSURANCE view — SPLIT into (a) BE claims-read [DONE C475] + (b) FE
            read-only variant + eyes-on [next].** A viewer currently sees no insurance on a shared vehicle (the
            whole tab is owner-gated, C100). To show it read-only needs: (a) widen the claims sub-reads + (b) a
            read-only PolicyList/PolicyCard/ClaimsSection variant. Was SAFE (hidden, not broken) the whole time.
        - [x] **(a) — claims-read widening + blast-radius (C475, 2026-06-27).** `GET /insurance/:id/claims`
              flipped `validateInsuranceOwnership` → a new `requirePolicyReadVehicles` gate: the OWNER always
              reads; a NON-owner reads the policy claims only if they hold accepted-share READ access to AT LEAST
              ONE vehicle the policy covers (else 404, existence-hiding #80). The §6.4 blast-radius decision was
              CLEAN-CUT (not escalated) — risk-4 + the ratified T8b `narrowPolicyToVehicle` precedent dictate it
              mechanically: the route is policy-keyed but a share grants per-VEHICLE, so a shared invitee sees
              ONLY claims attributed to a vehicle they can read; a claim with `vehicleId=null` (unattributed) or
              on the owner's OTHER vehicle is dropped; the owner view is unchanged. Strictly additive (a viewer
              sees no insurance today) + no displayed-$ change. +5 cases in shared-insurance-read.test.ts (viewer
              sees only the shared-vehicle claim with owner-other + unattributed dropped, owner sees all, editor
              reads, stranger-404, pending-404) + a T12b-3c IDOR entry (third party with no covered-vehicle share
              denied the claims list). validate:local green (2121 pass [+6], 0 fail). Commit 9f18b75.
        - [ ] **(b) — FE read-only insurance variant + eyes-on (next).** A read-only InsuranceTab path for a
              viewer: render PolicyList/PolicyCard/PolicyTermCard/ClaimsSection/DocumentViewer with every mutate
              affordance hidden (Add-Policy, Edit-policy, Edit/Delete/Renew-term, File/Edit/Delete-claim, Upload/
              Delete-document — the 10 affordances scouted C475), un-gate the tab for a non-owner in read-only
              mode (it is `isOwner`-gated today on the [id] page), and boot+shoot a viewer session to confirm the
              read-only insurance renders with NO mutate chrome + no console errors. Backend already enforces
              every denial (defense-in-depth UX). Reads used: getPoliciesForVehicle (T8b) + getClaims (this slice)
              + getEntityDocuments. The per-vehicle policies LIST read (T8b) + claims read (this slice) are both
              live, so the FE has all the data it needs.
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
