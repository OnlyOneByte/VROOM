import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { parseClampedInt } from '../../utils/calculations';
import { insuranceClaimToApi, insuranceTermToApi } from '../../utils/money';
import { requireVehicleRead, resolveVehicleAccess } from '../../utils/sharing';
import {
  validateInsuranceOwnership,
  validateVehicleOwnership,
  zValidator,
} from '../../utils/validation';
import { expenseRepository } from '../expenses/repository';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { insuranceClaimRepository } from './claims-repository';
import { createClaimSchema, updateClaimSchema } from './claims-validation';
import { createTermExpenses, updateTermExpenses, vehicleIdsForTerm } from './hooks';
import { insurancePolicyRepository } from './repository';
import {
  addTermSchema,
  createPolicySchema,
  updatePolicySchema,
  updateTermSchema,
} from './validation';

const routes = new Hono();

function policyToApi<T extends Record<string, unknown>>(policy: T): T {
  const terms = policy.terms;
  if (!Array.isArray(terms)) return policy;
  return {
    ...policy,
    terms: terms.map((t) => insuranceTermToApi(t as Record<string, unknown>)),
  };
}

function narrowPolicyToVehicle<
  T extends {
    terms: Array<{ id: string }>;
    termVehicleCoverage: Array<{ termId: string; vehicleId: string }>;
    vehicleIds: string[];
  },
>(policy: T, vehicleId: string): T {
  const coveredTermIds = new Set(
    policy.termVehicleCoverage.filter((c) => c.vehicleId === vehicleId).map((c) => c.termId)
  );
  return {
    ...policy,
    terms: policy.terms.filter((t) => coveredTermIds.has(t.id)),
    termVehicleCoverage: policy.termVehicleCoverage.filter((c) => c.vehicleId === vehicleId),
    vehicleIds: policy.vehicleIds.filter((v) => v === vehicleId),
  };
}

async function requirePolicyReadVehicles(
  policyId: string,
  userId: string
): Promise<{ isOwner: boolean; readableVehicleIds: Set<string> }> {
  const policy = await insurancePolicyRepository.findById(policyId);
  if (!policy) throw new NotFoundError('Insurance policy');
  if (policy.userId === userId) return { isOwner: true, readableVehicleIds: new Set() };

  const readableVehicleIds = new Set<string>();
  for (const vehicleId of policy.vehicleIds) {
    if (await resolveVehicleAccess(vehicleId, userId)) readableVehicleIds.add(vehicleId);
  }
  if (readableVehicleIds.size === 0) throw new NotFoundError('Insurance policy');
  return { isOwner: false, readableVehicleIds };
}

const idParamSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
});

const termParamsSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
  termId: z.string().min(1, 'Term ID is required'),
});

const claimParamsSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
  claimId: z.string().min(1, 'Claim ID is required'),
});

async function validateClaimRefs(
  data: { vehicleId?: string | null; termId?: string | null },
  policyId: string,
  userId: string
): Promise<void> {
  if (data.vehicleId) {
    await validateVehicleOwnership(data.vehicleId, userId);
  }
  if (data.termId) {
    const policy = await insurancePolicyRepository.findById(policyId);
    const onThisPolicy = policy?.terms.some((t) => t.id === data.termId);
    if (!onThisPolicy) {
      throw new ValidationError('Claim termId does not belong to this policy');
    }
  }
}

const vehiclePoliciesParamSchema = z.object({
  vehicleId: z.string().min(1, 'Vehicle ID is required'),
});

routes.use('*', requireAuth);
routes.use('*', changeTracker);

routes.get('/', async (c) => {
  const user = c.get('user');
  const policies = await insurancePolicyRepository.findByUserId(user.id);
  return c.json({ success: true, data: policies.map(policyToApi), count: policies.length });
});

routes.get('/expiring-soon', async (c) => {
  const user = c.get('user');
  const daysAhead = parseClampedInt(c.req.query('days'), 30, 1, 366);
  const limit = parseClampedInt(c.req.query('limit'), 100, 1, 200);
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const terms = await insurancePolicyRepository.findExpiringTerms(now, endDate, user.id, limit);
  return c.json({
    success: true,
    data: terms.map((t) => insuranceTermToApi(t)),
    count: terms.length,
    daysAhead,
    limit,
  });
});

routes.get(
  '/vehicles/:vehicleId/policies',
  zValidator('param', vehiclePoliciesParamSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const access = await requireVehicleRead(vehicleId, user.id);
    const policies = await insurancePolicyRepository.findByVehicleId(vehicleId);
    const scoped =
      access.role === 'owner' ? policies : policies.map((p) => narrowPolicyToVehicle(p, vehicleId));
    return c.json({ success: true, data: scoped.map(policyToApi), count: scoped.length });
  }
);

routes.post('/', zValidator('json', createPolicySchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const policy = await insurancePolicyRepository.create(data, user.id);

  for (const term of policy.terms) {
    const termVehicleIds = vehicleIdsForTerm(policy.termVehicleCoverage, term.id);
    await createTermExpenses({
      termId: term.id,
      vehicleIds: termVehicleIds,
      totalCost: term.totalCost ?? 0,
      monthlyCost: term.monthlyCost,
      startDate: term.startDate,
      endDate: term.endDate,
      policyNumber: term.policyNumber ?? undefined,
      userId: user.id,
    });
  }

  return c.json(
    { success: true, data: policyToApi(policy), message: 'Insurance policy created successfully' },
    201
  );
});

routes.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const policy = await validateInsuranceOwnership(id, user.id);
  return c.json({ success: true, data: policyToApi(policy) });
});

routes.put(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updatePolicySchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const data = c.req.valid('json');
    const policy = await insurancePolicyRepository.update(id, data, user.id);
    return c.json({
      success: true,
      data: policyToApi(policy),
      message: 'Insurance policy updated successfully',
    });
  }
);

routes.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);

  // Photos have no FK, so they must be removed before the policy cascade orphans them.
  const claims = await insuranceClaimRepository.findByPolicyId(id);
  const claimIds = claims.map((claim) => claim.id);
  await deleteAllPhotosForEntity('insurance_policy', id, user.id);
  await deletePhotosForEntities('insurance_claim', claimIds, user.id);

  // Premium expenses link to terms by text, not FK, so they must be deleted explicitly before the cascade.
  const policyToDelete = await insurancePolicyRepository.findById(id);
  for (const term of policyToDelete?.terms ?? []) {
    await expenseRepository.deleteBySource('insurance_term', term.id, user.id);
  }

  await insurancePolicyRepository.delete(id, user.id);
  return c.json({ success: true, message: 'Insurance policy deleted successfully' });
});

routes.post(
  '/:id/terms',
  zValidator('param', idParamSchema),
  zValidator('json', addTermSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const termData = c.req.valid('json');
    const policy = await insurancePolicyRepository.addTerm(id, termData, user.id);

    const termVehicleIds = vehicleIdsForTerm(policy.termVehicleCoverage, policy.newTermId);
    await createTermExpenses({
      termId: policy.newTermId,
      vehicleIds: termVehicleIds,
      totalCost: termData.totalCost ?? 0,
      monthlyCost: termData.monthlyCost,
      startDate: termData.startDate,
      endDate: termData.endDate,
      policyNumber: termData.policyNumber,
      userId: user.id,
    });

    return c.json(
      { success: true, data: policyToApi(policy), message: 'Term added successfully' },
      201
    );
  }
);

routes.put(
  '/:id/terms/:termId',
  zValidator('param', termParamsSchema),
  zValidator('json', updateTermSchema),
  async (c) => {
    const user = c.get('user');
    const { id, termId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const updates = c.req.valid('json');
    const policy = await insurancePolicyRepository.updateTerm(id, termId, updates, user.id);

    const updatedTerm = policy.terms.find((t) => t.id === termId);
    if (updatedTerm) {
      const termVehicleIds = vehicleIdsForTerm(policy.termVehicleCoverage, termId);
      await updateTermExpenses({
        termId,
        vehicleIds: termVehicleIds,
        totalCost: updatedTerm.totalCost ?? 0,
        monthlyCost: updatedTerm.monthlyCost,
        startDate: updatedTerm.startDate,
        endDate: updatedTerm.endDate,
        policyNumber: updatedTerm.policyNumber ?? undefined,
        userId: user.id,
      });
    }

    return c.json({
      success: true,
      data: policyToApi(policy),
      message: 'Term updated successfully',
    });
  }
);

routes.delete('/:id/terms/:termId', zValidator('param', termParamsSchema), async (c) => {
  const user = c.get('user');
  const { id, termId } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);

  // Premium expenses link to terms by text, not FK, so they must be deleted explicitly.
  await expenseRepository.deleteBySource('insurance_term', termId, user.id);

  const policy = await insurancePolicyRepository.deleteTerm(id, termId, user.id);
  return c.json({ success: true, data: policyToApi(policy), message: 'Term deleted successfully' });
});

routes.get('/:id/claims', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const { isOwner, readableVehicleIds } = await requirePolicyReadVehicles(id, user.id);
  const claims = await insuranceClaimRepository.findByPolicyId(id);
  const scoped = isOwner
    ? claims
    : claims.filter((cl) => cl.vehicleId !== null && readableVehicleIds.has(cl.vehicleId));
  return c.json({
    success: true,
    data: scoped.map((cl) => insuranceClaimToApi(cl)),
    count: scoped.length,
  });
});

routes.post(
  '/:id/claims',
  zValidator('param', idParamSchema),
  zValidator('json', createClaimSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const data = c.req.valid('json');
    await validateClaimRefs(data, id, user.id);
    const claim = await insuranceClaimRepository.create(id, data);
    return c.json(
      { success: true, data: insuranceClaimToApi(claim), message: 'Claim filed successfully' },
      201
    );
  }
);

routes.put(
  '/:id/claims/:claimId',
  zValidator('param', claimParamsSchema),
  zValidator('json', updateClaimSchema),
  async (c) => {
    const user = c.get('user');
    const { id, claimId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const updates = c.req.valid('json');
    await validateClaimRefs(updates, id, user.id);
    const claim = await insuranceClaimRepository.update(id, claimId, updates);
    return c.json({
      success: true,
      data: insuranceClaimToApi(claim),
      message: 'Claim updated successfully',
    });
  }
);

routes.delete('/:id/claims/:claimId', zValidator('param', claimParamsSchema), async (c) => {
  const user = c.get('user');
  const { id, claimId } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);
  await deleteAllPhotosForEntity('insurance_claim', claimId, user.id);
  await insuranceClaimRepository.delete(id, claimId);
  return c.json({ success: true, message: 'Claim deleted successfully' });
});

export { routes };
