import type { Context } from 'hono';
import { repos } from '../../app-context';
import { NotFoundError } from '../../errors';
import type { ResourceOf } from '../../permissions/authorize';
import { loadResolver } from '../../permissions/grants';
import type { Resource } from '../../permissions/resolve';

async function findPolicy(policyId: string) {
  const policy = await repos().insurancePolicies.findById(policyId);
  if (!policy) throw new NotFoundError('Insurance policy');
  return policy;
}

function coveredVehicles(policy: { vehicleIds: string[] }): Resource[] {
  return policy.vehicleIds.map((vehicleId) => ({ kind: 'vehicle', vehicleId }));
}

export async function policyDocumentResources(
  c: Context,
  policyId: string
): Promise<Resource | Resource[]> {
  const policy = await findPolicy(policyId);
  const owner: Resource = { kind: 'account', userId: policy.userId };
  if (c.req.method !== 'GET' || policy.userId === c.get('user').id) return owner;
  const vehicles = coveredVehicles(policy);
  return vehicles.length > 0 ? vehicles : owner;
}

export const fromPolicyOwner: ResourceOf = async (c) => {
  const policy = await findPolicy(c.req.param('id') ?? '');
  return { kind: 'account', userId: policy.userId };
};

export const fromPolicyReaders: ResourceOf = async (c) => {
  const policy = await findPolicy(c.req.param('id') ?? '');
  const vehicles = coveredVehicles(policy);
  const first = vehicles[0];
  if (policy.userId === c.get('user').id || !first) {
    return { kind: 'account', userId: policy.userId };
  }
  const resolver = await loadResolver(c, vehicles);
  return vehicles.find((resource) => resolver.can('vehicle.read', resource).allow) ?? first;
};
