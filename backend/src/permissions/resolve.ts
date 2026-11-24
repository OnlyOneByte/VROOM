import { createMongoAbility, type MongoAbility, type RawRuleOf } from '@casl/ability';
import { type PackRule, packRules } from '@casl/ability/extra';
import { PERMISSION_REGISTRY } from './registry';
import { type PermissionScope, parsePermissionId } from './vocabulary';

export interface Actor {
  userId: string;
  disabled: boolean;
}

export type Resource =
  | { kind: 'server' }
  | { kind: 'account'; userId: string }
  | { kind: 'vehicle'; vehicleId: string; entryCreatedBy?: string | null };

export type DenyReason = 'not_found' | 'forbidden' | 'denied_override' | 'disabled';

export type Decision =
  | { allow: true; via: 'owner' | 'override' | 'role'; roleIds: string[] }
  | { allow: false; reason: DenyReason };

export interface HeldRole {
  id: string;
  permissions: readonly string[];
  builtInDemo?: boolean;
}

export interface HeldOverride {
  permission: string;
  effect: 'allow' | 'deny';
}

export interface ScopeGrants {
  roles: readonly HeldRole[];
  overrides: readonly HeldOverride[];
}

export interface VehicleFacts {
  owner: boolean;
  member: boolean;
  demoGarage: boolean;
  grants: ScopeGrants;
}

export interface GrantSource {
  serverGrants(userId: string): ScopeGrants;
  vehicleFacts(userId: string, vehicleId: string): VehicleFacts | null;
}

type RuleReason = 'owner' | 'role' | 'override' | 'denied_override';
type Ability = MongoAbility<[string, 'all']>;
type Rule = RawRuleOf<Ability>;

type ScopeState =
  | { kind: 'hidden' }
  | { kind: 'owner'; rules: Rule[] }
  | { kind: 'rules'; rules: Rule[]; ability: Ability; roles: readonly HeldRole[] };

const SERVER_REACH: readonly PermissionScope[] = ['server', 'account'];
const VEHICLE_REACH: readonly PermissionScope[] = ['vehicle'];

function transitiveClosure(edges: (id: string) => readonly string[], start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const next of edges(id)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

const IMPLIED_BY = new Map<string, string[]>();
for (const descriptor of PERMISSION_REGISTRY.list) {
  for (const target of descriptor.implies) {
    IMPLIED_BY.set(target, [...(IMPLIED_BY.get(target) ?? []), descriptor.id]);
  }
}

export function withImplied(permission: string): Set<string> {
  return transitiveClosure((id) => PERMISSION_REGISTRY.get(id)?.implies ?? [], permission);
}

export function targets(permission: string): Set<string> {
  return transitiveClosure((id) => IMPLIED_BY.get(id) ?? [], permission);
}

function usable(permission: string, reach: readonly PermissionScope[]): boolean {
  const descriptor = PERMISSION_REGISTRY.get(permission);
  return Boolean(descriptor?.grantable && reach.includes(descriptor.scope));
}

function rule(action: string, reason: RuleReason, inverted = false): Rule {
  return inverted
    ? { action, subject: 'all', inverted, reason }
    : { action, subject: 'all', reason };
}

export function buildRules(grants: ScopeGrants, reach: readonly PermissionScope[]): Rule[] {
  const expand = (permission: string) =>
    PERMISSION_REGISTRY.get(permission)?.grantable
      ? [...withImplied(permission)].filter((p) => usable(p, reach))
      : [];
  const roleRules = grants.roles.flatMap((role) =>
    role.permissions.flatMap(expand).map((p) => rule(p, 'role'))
  );
  const allowRules = grants.overrides
    .filter((o) => o.effect === 'allow')
    .flatMap((o) => expand(o.permission).map((p) => rule(p, 'override')));
  const denyRules = grants.overrides
    .filter((o) => o.effect === 'deny' && PERMISSION_REGISTRY.has(o.permission))
    .flatMap((o) => [...denyTargets(o.permission)].map((p) => rule(p, 'denied_override', true)));
  const unique = new Map<string, Rule>();
  for (const r of [...roleRules, ...allowRules, ...denyRules]) {
    unique.set(`${r.reason}:${r.action}`, r);
  }
  return [...unique.values()];
}

const OWNER_RULES: Rule[] = PERMISSION_REGISTRY.list
  .filter((d) => d.scope === 'vehicle')
  .map((d) => rule(d.id, 'owner'));

function denyTargets(permission: string): Set<string> {
  const own = ownDeleteOf(permission);
  return own ? new Set([...targets(permission), ...targets(own)]) : targets(permission);
}

function servesResource(permission: string, resource: Resource): boolean {
  const scope = PERMISSION_REGISTRY.get(permission)?.scope;
  if (!scope) return false;
  if (resource.kind === 'account') return true;
  return resource.kind === 'vehicle' ? scope === 'vehicle' : scope !== 'vehicle';
}

function isOwnVehicleData(permission: string, resource: Resource): boolean {
  return resource.kind === 'account' && PERMISSION_REGISTRY.get(permission)?.scope === 'vehicle';
}

function ownDeleteOf(permission: string): string | null {
  if (parsePermissionId(permission)?.action !== 'delete') return null;
  const own = `${permission}_own`;
  return PERMISSION_REGISTRY.has(own) ? own : null;
}

function rulesState(rules: Rule[], roles: readonly HeldRole[]): ScopeState {
  return { kind: 'rules', rules, ability: createMongoAbility<Ability>(rules), roles };
}

function evaluate(state: Extract<ScopeState, { kind: 'rules' }>, permission: string): Decision {
  const relevant = state.ability.relevantRuleFor(permission, 'all');
  if (!relevant) return { allow: false, reason: 'forbidden' };
  if (relevant.inverted) return { allow: false, reason: 'denied_override' };
  if (relevant.reason === 'override') return { allow: true, via: 'override', roleIds: [] };
  const roleIds = state.roles
    .filter((role) => role.permissions.some((p) => withImplied(p).has(permission)))
    .map((role) => role.id);
  return { allow: true, via: 'role', roleIds };
}

function evaluateEntry(
  state: Extract<ScopeState, { kind: 'rules' }>,
  permission: string,
  entryCreatedBy: string | null | undefined,
  actorId: string
): Decision {
  const ownEntry = entryCreatedBy === actorId;
  if (permission.endsWith('.delete_own') && entryCreatedBy != null && !ownEntry) {
    return { allow: false, reason: 'forbidden' };
  }
  const decision = evaluate(state, permission);
  const own = ownEntry ? ownDeleteOf(permission) : null;
  if (decision.allow || !own) return decision;
  const ownDecision = evaluate(state, own);
  return ownDecision.allow ? ownDecision : decision;
}

export interface Resolver {
  can(permission: string, resource: Resource): Decision;
  rulesFor(resource: Resource): Rule[];
  packedRulesFor(resource: Resource): PackRule<Rule>[];
}

export function createResolver(actor: Actor, source: GrantSource): Resolver {
  const states = new Map<string, ScopeState>();

  const serverState = (): ScopeState => {
    const grants = source.serverGrants(actor.userId);
    return rulesState(buildRules(grants, SERVER_REACH), grants.roles);
  };

  const vehicleState = (vehicleId: string): ScopeState => {
    const facts = source.vehicleFacts(actor.userId, vehicleId);
    if (!facts) return { kind: 'hidden' };
    if (facts.owner) return { kind: 'owner', rules: OWNER_RULES };
    if (facts.member) {
      return rulesState(buildRules(facts.grants, VEHICLE_REACH), facts.grants.roles);
    }
    const demoRoles = facts.demoGarage
      ? source.serverGrants(actor.userId).roles.filter((role) => role.builtInDemo)
      : [];
    if (demoRoles.length === 0) return { kind: 'hidden' };
    const demoReads = demoRoles.map((role) => ({
      ...role,
      permissions: role.permissions.filter((p) => parsePermissionId(p)?.action === 'read'),
    }));
    return rulesState(buildRules({ roles: demoReads, overrides: [] }, VEHICLE_REACH), demoReads);
  };

  const stateFor = (resource: Resource): ScopeState => {
    if (resource.kind === 'account' && resource.userId !== actor.userId) return { kind: 'hidden' };
    const key = resource.kind === 'vehicle' ? `vehicle:${resource.vehicleId}` : 'server';
    let state = states.get(key);
    if (!state) {
      state = resource.kind === 'vehicle' ? vehicleState(resource.vehicleId) : serverState();
      states.set(key, state);
    }
    return state;
  };

  const can = (permission: string, resource: Resource): Decision => {
    if (!servesResource(permission, resource)) return { allow: false, reason: 'forbidden' };
    if (actor.disabled) return { allow: false, reason: 'disabled' };
    const state = stateFor(resource);
    if (state.kind === 'hidden') return { allow: false, reason: 'not_found' };
    if (state.kind === 'owner' || isOwnVehicleData(permission, resource)) {
      return { allow: true, via: 'owner', roleIds: [] };
    }
    if (!PERMISSION_REGISTRY.get(permission)?.grantable) {
      return { allow: false, reason: 'forbidden' };
    }
    const entryCreatedBy = resource.kind === 'vehicle' ? resource.entryCreatedBy : undefined;
    return evaluateEntry(state, permission, entryCreatedBy, actor.userId);
  };

  const rulesFor = (resource: Resource): Rule[] => {
    if (actor.disabled) return [];
    const state = stateFor(resource);
    if (state.kind === 'hidden') return [];
    return resource.kind === 'account' ? [...state.rules, ...OWNER_RULES] : state.rules;
  };

  return { can, rulesFor, packedRulesFor: (resource) => packRules(rulesFor(resource)) };
}
