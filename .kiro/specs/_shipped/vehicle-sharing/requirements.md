# Vehicle Sharing — Requirements

> DRAFT (2026-06-24). **Greenfield "BIGGGG" feature** (TODO.md #9). Design-first per the loop DoD: a
> multi-user collaboration feature is not a single tractable increment, so this spec is written and
> signed off BEFORE any build. `tasks.md` is gated at T0 (Angelo ratifies D1–D8 below).
>
> ⚠️ STALE-CLAIM CORRECTION: TODO.md:141 says "types already defined" — that is NOT true. A schema grep
> finds NO sharing/invite/permission tables or types in `backend/src/db/schema.ts`. This is fully
> greenfield. The only related primitive is `users` (id/email) + the per-resource `validateXOwnership`
> family in `backend/src/utils/validation.ts` that today assumes single-owner.

## Problem
VROOM is single-owner today: every row is `userId`-scoped and a user only ever sees/writes their own
data (NORTH_STAR #2 cross-tenant isolation). But the target user is "often multi-vehicle / a household"
(NORTH_STAR). A couple sharing one car, or a family fleet, currently needs one shared login — which
breaks per-user attribution, audit, and the OAuth identity model. Sharing lets an **owner** grant
**another VROOM user** scoped access to a **specific vehicle**.

## Scope (v1)
**In:** invite another existing VROOM user (by email) to a SPECIFIC vehicle at a permission level
(view-only or editor); the invitee accepts/declines; shared vehicles appear in the invitee's fleet,
clearly marked "shared by X"; editors can log expenses/odometer/reminders on the shared vehicle;
owners manage (list/revoke/change-level) shares; all data-safety + cross-tenant guarantees preserved.

**Out (deferred, name them so scope is honest):** household/aggregate cross-owner analytics views
(TODO "Household view" — a separate spec); sharing whole fleets or accounts (only per-vehicle in v1);
inviting a non-VROOM user via email signup flow (v1 requires the invitee to already have an account);
real-time presence; transfer-of-ownership; sharing of storage-provider credentials (the invitee uses
the OWNER's backed-up data only through the owner's providers — providers are never shared).

## Decisions to ratify (T0 gate)
- **D1 — Is sharing the right next greenfield horizon feature now?** (vs. staying maintenance-only, or
  doing trips/money-cents first — both already greenlit 2026-06-24. Sharing is the largest of the three.)
- **D2 — Granularity: per-VEHICLE only (recommended) vs per-account vs per-resource.** Recommend
  per-vehicle: it matches the "share one car" mental model and bounds the cross-tenant blast radius.
- **D3 — Permission levels: `viewer` | `editor` (recommended 2-level) vs a richer matrix.** Recommend
  two: viewer (read all of that vehicle's expenses/analytics/insurance/reminders), editor (+ create/edit
  expenses, odometer, reminders on it). Neither can DELETE the vehicle, manage shares, or see the owner's
  OTHER vehicles. Owner is implicit and unshareable.
- **D4 — Invite model: invitee must be an existing VROOM user (recommended v1) vs email-signup invite.**
  Recommend existing-user-only for v1 (no email-delivery infra; the invite is an in-app pending row the
  invitee sees on next login). Surface "no VROOM account with that email" clearly.
- **D5 — Accept/decline handshake (recommended) vs auto-grant.** Recommend explicit accept — a user
  should opt into seeing someone else's vehicle in their fleet. Pending/accepted/declined/revoked states.
- **D6 — Data attribution: shared-created rows are stamped with the ACTING user (recommended) but still
  belong to the owner's vehicle.** An editor's expense shows "added by <editor>" yet lives under the
  owner's `userId` for backup/TCO. Decide whether the acting-user stamp is v1 or deferred.
- **D7 — Backup/restore semantics (NORTH_STAR #1).** The OWNER's backup includes the shares they granted
  + shared-created rows (they own the vehicle). The INVITEE's backup does NOT include the owner's vehicle
  (it isn't theirs). Decide: does a restore re-create pending invites, or only accepted grants?
- **D8 — Revocation cascade.** On revoke / vehicle-delete / owner-account-delete: the share row drops and
  the vehicle disappears from the invitee's fleet. Shared-created expense rows STAY with the owner's
  vehicle (they're real cost history — do not delete the invitee's past entries). Confirm this is right.

## Functional requirements
- **R1 — Share grant.** Owner invites `email` + `level` to a vehicle they own. Reject: self-invite,
  duplicate active share, non-existent user, a vehicle they don't own (404, the `validateVehicleOwnership`
  gate). Creates a `pending` share.
- **R2 — Accept/decline.** Invitee lists their pending invites, accepts (→ `accepted`) or declines
  (→ `declined`). Only the invitee can act on their own invite (cross-tenant gate).
- **R3 — Scoped read.** An accepted viewer/editor can GET the shared vehicle + its expenses / analytics /
  insurance / reminders / odometer — and NOTHING else of the owner's. Every existing read route's
  ownership gate must widen to "owner OR accepted-share" for exactly the shared vehicle.
- **R4 — Scoped write (editor only).** An accepted editor can POST/PUT expenses, odometer, reminders on
  the shared vehicle. A viewer cannot. Neither can DELETE the vehicle, edit financing/purchase, or manage
  shares. Writes are owner-`userId`-stamped (D6 acting-user stamp optional).
- **R5 — Manage.** Owner lists all shares on their vehicles, changes a level, or revokes. Invitee lists
  vehicles shared TO them and can self-remove (decline-after-accept).
- **R6 — Isolation preserved (NORTH_STAR #2, the load-bearing one).** The share is the ONLY widening of
  cross-`userId` access. Every state-changing + read route must be in `cross-tenant-idor.test.ts` proving:
  a non-shared third party is still denied; a viewer is denied writes; an editor is denied
  non-shared-vehicle access and owner-only actions (delete/financing/share-management).
- **R7 — Data safety (NORTH_STAR #1).** `vehicle_shares` round-trips through backup/restore (owner side);
  `validateReferentialIntegrity` covers it; the revocation cascade (D8) never deletes real cost history.
- **R8 — UI (eyes-on tail, NORTH_STAR #3).** A "Share" affordance on the vehicle page (owner); a "Shared
  with me" + pending-invite surface (invitee); shared vehicles badged "shared by X" in the fleet;
  viewer sees no edit affordances. Four-states + a11y + mobile; FE→BE→DB e2e (or "eyes-on pending").

## Non-goals / guardrails
- Sharing NEVER exposes the owner's OTHER vehicles, account settings, storage-provider credentials, or
  profile beyond display name. The widening is per-shared-vehicle and nothing else.
- This is the highest cross-tenant-risk feature in VROOM — R6 is non-negotiable and every route touched
  gets an IDOR-sweep entry before the slice is "done".
