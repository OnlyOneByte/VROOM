import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { insuranceClaimToApi, insuranceTermToApi } from '../../utils/money';
import { validateInsuranceOwnership, zValidator } from '../../utils/validation';
import { requireVehicleAccess, resolveVehicleAccess } from '../../utils/vehicle-access';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { insuranceClaimRepository } from './claims-repository';
import { createClaimSchema, updateClaimSchema } from './claims-validation';
import {
  assertTermPremiumWithinCap,
  createTermExpenses,
  deleteTermExpenses,
  updateTermExpenses,
  vehicleIdsForTerm,
} from './hooks';
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

function sharedPolicyView<
  T extends {
    terms: Array<{
      id: string;
      totalCost: number | null;
      monthlyCost: number | null;
      paymentAmount: number | null;
    }>;
    termVehicleCoverage: Array<{ termId: string; vehicleId: string }>;
    vehicleIds: string[];
  },
>(policy: T, vehicleId: string) {
  const coveredTermIds = new Set(
    policy.termVehicleCoverage.filter((c) => c.vehicleId === vehicleId).map((c) => c.termId)
  );
  return {
    ...policy,
    terms: policy.terms
      .filter((t) => coveredTermIds.has(t.id))
      .map(
        ({ totalCost: _total, monthlyCost: _monthly, paymentAmount: _payment, ...term }) => term
      ),
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

function termExpenseParams(
  policy: { termVehicleCoverage: Array<{ termId: string; vehicleId: string }> },
  term: {
    id: string;
    totalCost: number | null;
    monthlyCost: number | null;
    startDate: Date;
    endDate: Date;
    policyNumber: string | null;
  },
  userId: string
) {
  return {
    termId: term.id,
    vehicleIds: vehicleIdsForTerm(policy.termVehicleCoverage, term.id),
    totalCost: term.totalCost ?? 0,
    monthlyCost: term.monthlyCost,
    startDate: term.startDate,
    endDate: term.endDate,
    policyNumber: term.policyNumber ?? undefined,
    userId,
  };
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
    await requireVehicleAccess(data.vehicleId, userId, 'owner');
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

routes.get(
  '/vehicles/:vehicleId/policies',
  zValidator('param', vehiclePoliciesParamSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const access = await requireVehicleAccess(vehicleId, user.id, 'read');
    const policies = await insurancePolicyRepository.findByVehicleId(vehicleId);
    const scoped =
      access.role === 'owner' ? policies : policies.map((p) => sharedPolicyView(p, vehicleId));
    return c.json({ success: true, data: scoped.map(policyToApi), count: scoped.length });
  }
);

routes.post('/', zValidator('json', createPolicySchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  for (const term of data.terms) {
    assertTermPremiumWithinCap({ ...term, totalCost: term.totalCost ?? 0 });
  }
  const policy = await insurancePolicyRepository.create(data, user.id);

  try {
    for (const term of policy.terms) {
      await createTermExpenses(termExpenseParams(policy, term, user.id));
    }
  } catch (error) {
    for (const term of policy.terms) {
      await deleteTermExpenses(term.id, user.id);
    }
    await insurancePolicyRepository.delete(policy.id, user.id);
    throw error;
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
    await deleteTermExpenses(term.id, user.id);
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
    assertTermPremiumWithinCap({ ...termData, totalCost: termData.totalCost ?? 0 });
    const policy = await insurancePolicyRepository.addTerm(id, termData, user.id);

    const termVehicleIds = vehicleIdsForTerm(policy.termVehicleCoverage, policy.newTermId);
    try {
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
    } catch (error) {
      await insurancePolicyRepository.deleteTerm(id, policy.newTermId, user.id);
      throw error;
    }

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
    const existing = await insurancePolicyRepository.findById(id);
    const previousTerm = existing?.terms.find((t) => t.id === termId);
    const previous =
      existing && previousTerm ? termExpenseParams(existing, previousTerm, user.id) : undefined;
    if (previous) {
      assertTermPremiumWithinCap({
        totalCost: (updates.totalCost === undefined ? previous.totalCost : updates.totalCost) ?? 0,
        monthlyCost: updates.monthlyCost === undefined ? previous.monthlyCost : updates.monthlyCost,
        startDate: updates.startDate ?? previous.startDate,
        endDate: updates.endDate ?? previous.endDate,
      });
    }
    const policy = await insurancePolicyRepository.updateTerm(id, termId, updates, user.id);

    const updatedTerm = policy.terms.find((t) => t.id === termId);
    if (updatedTerm) {
      await updateTermExpenses(termExpenseParams(policy, updatedTerm, user.id), previous);
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
  await deleteTermExpenses(termId, user.id);

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
