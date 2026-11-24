# How a Feature Declares Its Permissions

Every action in VROOM is a permission: a string such as `vehicle.expense.write` or
`account.backup.run`. A feature declares its permissions in one `capabilities.ts` next to its
routes, and maps each of its routes to one of them. The registry and the route map are in
**report mode** today: they describe what each route needs, and the contract test keeps them
complete, but nothing at runtime reads them yet. Requests are still authorized by
`requireAuth` and `requireVehicleAccess`.

## Permission ids

An id is `<scope>.<resource>.<action>`, or `<scope>.<action>` for the scope itself
(`vehicle.read`, `account.delete`).

- **Scopes** (`PERMISSION_SCOPES` in `src/permissions/vocabulary.ts`): `server`, `account` and
  `vehicle`.
- **Actions**: `read`, `write` (create and update), `delete`, `delete_own` (entries the actor
  added), `manage` (change who can do things), `run` (trigger a job) and `use` (spend a shared
  resource). A few verbs that read badly as one of these are listed in `NAMED_ACTIONS`
  (`vehicle.transfer`, `account.backup.restore`). Add to that list only when no core action fits.
- Segments are lower-case `snake_case`.

## Declaring them

```typescript
import { definePermissions } from '../../permissions/vocabulary';

export const TRIP_PERMISSIONS = definePermissions({
  'vehicle.trip.read': { label: 'See trips', scope: 'vehicle' },
  'vehicle.trip.write': {
    label: 'Add and edit trips',
    scope: 'vehicle',
    implies: ['vehicle.trip.read'],
  },
});
```

Each descriptor carries:

| Field | Default | Meaning |
|---|---|---|
| `label` | required | The sentence the role table and the share dialog show. Write it for a person, not a developer |
| `scope` | required | Must match the first segment of the id |
| `grantable` | `true` | `false` for permissions only the vehicle owner holds (`vehicle.delete`, `vehicle.transfer`). No role or override can grant them |
| `implies` | `[]` | Permissions this one includes. Every `write` implies the `read` on the same resource |
| `sensitive` | `false` | `true` for data people expect to stay private (`vehicle.financing.read`, `vehicle.insurance.read`) |

Then spread the export into `DECLARED_PERMISSIONS` in `src/permissions/registry.ts`. The registry
validates every declaration when it loads and throws on a duplicate id, a malformed id, a scope
that doesn't match the id, or an `implies` target that isn't declared. `PermissionId` is the
union of every declared id, so a typo in the route map or a role template fails type-check.

The `server` scope has no routes yet, so it declares its permissions in
`src/permissions/server-capabilities.ts`.

## Role templates

The built-in roles (Admin, Member, Demo, Co-owner, Editor and Viewer) are permission sets in
`src/permissions/roles.ts`. Most are derived from the registry (Co-owner is every grantable
vehicle permission, Viewer every vehicle read except the two sensitive ones), so a new vehicle
permission reaches them without an edit. Editor is listed by hand; keep it a superset of Viewer.
Check that the result is what you want; the role tests pin the rules, including
Viewer ⊆ Editor ⊆ Co-owner.

A template can only list grantable permissions in its scope's reach: server roles hold server
and account permissions, vehicle roles hold vehicle permissions. Demo is the one server role that
may also hold vehicle reads, plus `account.session.manage` so a demo visitor can sign out. The
vehicle owner is not a template: the owner holds every vehicle permission.

## Roles, assignments and overrides

Roles are rows. `syncBuiltInRoles()` writes the templates into `roles` and `role_permissions` on
every start, with stable ids (`builtin_<key>`), so a template change needs no migration. Custom
roles are server roles (managed with `server.roles.manage`) or vehicle roles in an owner's own
library, assignable only on that owner's cars. Built-in roles can be copied (`copyFrom`) but not
edited or deleted; the built-in keys are reserved, and a role's scope never changes.

- `role_assignments` gives a person a role: at server scope (`scope_id` null), or on one vehicle.
  Everyone holds Member, and the demo user Demo. Accepting a share clears anything left over for
  that person on that car and assigns Editor or Viewer from its level; changing the level swaps
  it; revoking or leaving deletes that person's vehicle assignments and overrides. Each of these
  re-reads the share in its transaction and answers 409 if it changed underneath. `vehicle_shares` stays the membership and invite record.
- `permission_overrides` allows or denies one permission for one person, at server or vehicle scope.
  A deny on `delete_own` does not stop someone who also holds `delete`; deny `delete` for that.
- A full restore is refused (409) while the account's vehicles carry overrides or custom-role
  assignments, since the restore re-creates the vehicles and would drop them. Merge mode is fine.

`can()` in `src/permissions/resolve.ts` decides, following the design's algorithm:

1. Unknown permission, or one that doesn't fit the resource → forbidden. Disabled user → disabled.
2. The scope chain: server and the actor's own account resolve at server scope; a vehicle only at
   that vehicle. Another person's account → not found.
3. The vehicle owner holds every vehicle permission, overrides ignored. Without an accepted share
   → not found. A non-grantable permission → forbidden.
4. CASL, with later rules winning: one `can` per role permission, then one per allow override,
   then one `cannot` per deny override on the denied permission and every permission that implies
   it. Roles and overrides are closed under `implies`, so a deny on `read` also blocks `write`,
   and a deny on `delete` also blocks `delete_own`. A non-grantable permission in a role row or
   an override grants nothing, not even what it implies.
5. A `delete` check also passes on `delete_own` when the entry's `createdBy` is the actor.

The Demo role's vehicle reads count only for the built-in Demo row (built-in flag plus key), and
only on the demo garage: vehicles whose owner holds that row. `GET /auth/capabilities` returns the
caller's packed server and account rules, and the frontend `can()` in
`src/lib/utils/permissions.ts` reads them.

Writes go through the escalation guards in `src/permissions/grants.ts`: you grant only permissions
you hold, assign only roles whose permissions you hold, the registry refuses unknown,
non-grantable and out-of-scope permissions (a custom server role can't hold vehicle permissions),
and the last holder of `server.roles.manage` keeps it. The API is `/roles`,
`/roles/:id/permissions`, `/role-assignments`, `/overrides` and `/vehicles/:id/people`.

A new resolution rule gets a row in `src/permissions/__tests__/resolution.cases.json`; the backend
and frontend suites both run it.

## Mapping the routes

Every route mounted in `src/app.ts` has one entry in `ROUTE_PERMISSIONS`
(`src/permissions/route-map.ts`), keyed by method and full path:

```typescript
'PUT /api/v1/trips/:id': 'vehicle.trip.write',
'GET /api/v1/auth/callback/:authProvider': { public: 'Sign-in callback from the provider' },
```

- Pick the permission the handler needs today. A handler that calls
  `requireVehicleAccess(id, user.id, 'write')` on an expense maps to `vehicle.expense.write`.
- Use `{ public: '<reason>' }` only for routes a signed-out visitor must reach: health, the
  sign-in flow. The reason says why.

`src/permissions/__tests__/route-map.test.ts` walks `app.routes` and fails on a route with no
entry, naming the route and the file to edit, and on an entry that matches no route. Run it with
`bun test src/permissions` after adding or renaming a route.

## Serving them

`GET /api/v1/auth/capabilities` returns every descriptor (`id`, `label`, `scope`, `grantable`,
`implies`, `sensitive`) and the role templates, so the frontend can render what each role can do
from the same source.
