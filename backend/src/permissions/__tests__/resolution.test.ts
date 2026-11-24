import { describe, expect, test } from 'bun:test';
import { ForbiddenError, ValidationError } from '../../errors';
import { refuseUngrantable, refuseUnheld } from '../grants';
import {
  createResolver,
  type Decision,
  type GrantSource,
  type HeldOverride,
  type HeldRole,
  type Resource,
} from '../resolve';
import type { RoleScope } from '../roles';
import CASES from './resolution.cases.json';

export interface ResolutionCase {
  name: string;
  permission: string;
  resource?: 'vehicle' | 'server' | 'own_account' | 'other_account';
  owner?: boolean;
  member?: boolean;
  disabled?: boolean;
  demoGarage?: boolean;
  entry?: 'own' | 'other';
  roles?: HeldRole[];
  serverRoles?: HeldRole[];
  overrides?: HeldOverride[];
  decision: Decision;
  packed: ReturnType<ReturnType<typeof createResolver>['packedRulesFor']>;
}

const ACTOR = 'actor';

function resourceOf(row: ResolutionCase): Resource {
  if (row.resource === 'server') return { kind: 'server' };
  if (row.resource === 'own_account') return { kind: 'account', userId: ACTOR };
  if (row.resource === 'other_account') return { kind: 'account', userId: 'someone' };
  const entryCreatedBy = row.entry === 'own' ? ACTOR : row.entry === 'other' ? 'someone' : null;
  return { kind: 'vehicle', vehicleId: 'v1', entryCreatedBy };
}

function sourceOf(row: ResolutionCase): GrantSource {
  const grants = { roles: row.roles ?? [], overrides: row.overrides ?? [] };
  const onVehicle = row.resource === undefined || row.resource === 'vehicle';
  return {
    serverGrants: () => (onVehicle ? { roles: row.serverRoles ?? [], overrides: [] } : grants),
    vehicleFacts: () => ({
      owner: row.owner ?? false,
      member: row.member ?? !row.owner,
      demoGarage: row.demoGarage ?? false,
      grants,
    }),
  };
}

export function resolveCase(row: ResolutionCase) {
  const resolver = createResolver(
    { userId: ACTOR, disabled: row.disabled ?? false },
    sourceOf(row)
  );
  const resource = resourceOf(row);
  return {
    decision: resolver.can(row.permission, resource),
    packed: resolver.packedRulesFor(resource),
  };
}

describe('resolution suite (resolution.cases.json, shared with the frontend)', () => {
  test.each(CASES as ResolutionCase[])('$name', (row) => {
    const { decision, packed } = resolveCase(row);
    expect(decision).toEqual(row.decision);
    expect(
      packed,
      'The packed rules in resolution.cases.json are stale: paste the received rules into the case'
    ).toEqual(row.packed);
  });
});

const HOLDS_EXPENSES = (permission: string) => permission.startsWith('vehicle.expense.');

const GUARD_CASES: {
  name: string;
  check: () => void;
  refused?: typeof ForbiddenError | typeof ValidationError;
}[] = [
  {
    name: 'granting a permission you hold is allowed',
    check: () => refuseUnheld(['vehicle.expense.write'], HOLDS_EXPENSES),
  },
  {
    name: 'granting a permission you do not hold is refused',
    check: () => refuseUnheld(['vehicle.financing.read'], HOLDS_EXPENSES),
    refused: ForbiddenError,
  },
  {
    name: 'assigning a role whose permissions you all hold is allowed',
    check: () => refuseUnheld(['vehicle.expense.read', 'vehicle.expense.write'], HOLDS_EXPENSES),
  },
  {
    name: 'assigning a role with one permission you lack is refused',
    check: () => refuseUnheld(['vehicle.expense.read', 'vehicle.trip.write'], HOLDS_EXPENSES),
    refused: ForbiddenError,
  },
  ...(
    [
      ['vehicle', 'vehicle.delete', ValidationError],
      ['vehicle', 'vehicle.transfer', ValidationError],
      ['vehicle', 'vehicle.secret.read', ValidationError],
      ['server', 'vehicle.read', ValidationError],
      ['vehicle', 'account.delete', ValidationError],
      ['server', 'account.delete', undefined],
      ['server', 'server.roles.manage', undefined],
      ['vehicle', 'vehicle.expense.delete_own', undefined],
    ] as const
  ).map(([scope, permission, refused]) => ({
    name: `a ${scope} role or override ${refused ? 'refuses' : 'accepts'} ${permission}`,
    check: () => refuseUngrantable(scope as RoleScope, [permission]),
    refused,
  })),
];

describe('escalation guards', () => {
  test.each(GUARD_CASES)('$name', ({ check, refused }) => {
    if (refused) expect(check).toThrow(refused);
    else expect(check).not.toThrow();
  });
});
