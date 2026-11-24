import type { Context } from 'hono';
import { getDb } from '../../db/connection';
import { NotFoundError } from '../../errors';
import type { ResourceOf } from '../../permissions/authorize';
import { requestResolver } from '../../permissions/grants';
import type { Resource } from '../../permissions/resolve';
import { insurancePolicyRepository } from './repository';

export async function policyResources(
  c: Context,
  policyId: string,
  permission: string
): Promise<Resource[]> {
  const policy = await insurancePolicyRepository.findById(policyId);
  if (!policy) throw new NotFoundError('Insurance policy');
  const owner: Resource = { kind: 'account', userId: policy.userId };
  if (policy.userId === c.get('user').id) return [owner];
  const resolver = requestResolver(c, getDb());
  const vehicles: Resource[] = policy.vehicleIds.map((vehicleId) => ({
    kind: 'vehicle',
    vehicleId,
  }));
  const allowed = vehicles.filter((resource) => resolver.can(permission, resource).allow);
  if (allowed.length > 0) return allowed;
  return vehicles.length > 0 ? vehicles.slice(0, 1) : [owner];
}

export const fromPolicyOwner: ResourceOf = async (c) => {
  const policy = await insurancePolicyRepository.findById(c.req.param('id') ?? '');
  if (!policy) throw new NotFoundError('Insurance policy');
  return { kind: 'account', userId: policy.userId };
};

export const fromPolicyReaders: ResourceOf = (c) =>
  policyResources(c, c.req.param('id') ?? '', 'vehicle.read');
