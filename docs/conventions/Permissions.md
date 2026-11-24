# How a Feature Declares Its Permissions

Every action in VROOM is a permission: a string such as `vehicle.expense.write` or
`account.backup.run`. A feature declares its permissions in one `capabilities.ts` next to its
routes, and maps each of its routes to one of them. The registry and the route map are in
**report mode** today: they describe what each route needs, and the contract test keeps them
complete, but nothing at runtime reads them yet. Requests are still authorized by
`requireAuth` and `requireVehicleAccess`.

## Permission ids

An id is `<scope>.<resource>.<action>`, or `<scope>.<action>` for the scope itself
(`vehicle.read`, `household.manage`).

- **Scopes** (`PERMISSION_SCOPES` in `src/permissions/vocabulary.ts`): `server`, `account`,
  `household` and `vehicle`.
- **Actions**: `read`, `write` (create and update), `delete`, `delete_own` (entries the actor
  added), `manage` (change who can do things), `run` (trigger a job) and `use` (spend a shared
  resource). A few verbs that read badly as one of these are listed in `NAMED_ACTIONS`
  (`vehicle.transfer`, `household.member.invite`). Add to that list only when no core action fits.
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
| `sensitive` | `false` | `true` for data people expect to stay private (`vehicle.financing.read`, `vehicle.insurance.read`, `household.stats.read_others`) |

Then spread the export into `DECLARED_PERMISSIONS` in `src/permissions/registry.ts`. The registry
validates every declaration when it loads and throws on a duplicate id, a malformed id, a scope
that doesn't match the id, or an `implies` target that isn't declared. `PermissionId` is the
union of every declared id, so a typo in the route map or a role template fails type-check.

Scopes without routes yet (`server`, `household`) declare theirs in `src/permissions/`.

## Role templates

The built-in roles (Admin, Member, Demo, Co-owner, Editor, Viewer, Household admin, Household
member) are permission sets in `src/permissions/roles.ts`. Most are derived from the registry
(Co-owner is every grantable vehicle permission, Viewer every vehicle read except the two
sensitive ones), so a new vehicle permission reaches them without an edit. Check that the result
is what you want; the role tests pin the rules. A template can only list grantable permissions
in its scope's reach. The vehicle owner is not a template: the owner holds every vehicle
permission.

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
