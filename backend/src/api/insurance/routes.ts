import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { appContext, repos } from '../../app-context';
import { NotFoundError, ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { authorize, ownAccount, vehicleParam } from '../../permissions/authorize';
import { loadResolver, requestResolver, vehicleResources } from '../../permissions/grants';
import {
  insuranceClaimFromApi,
  insuranceClaimToApi,
  insuranceTermFromApi,
  insuranceTermToApi,
} from '../../utils/money';
import { validateInsuranceOwnership, zValidator } from '../../utils/validation';
import { requireVehicleAccess } from '../../utils/vehicle-access';
import { deleteAllPhotosForEntity, deletePhotosForEntities } from '../photos/photo-service';
import { fromPolicyOwner, fromPolicyReaders } from './access';
import { createClaimSchema, updateClaimSchema } from './claims-validation';
import {
  assertTermPremiumWithinCap,
  createTermExpenses,
  deleteTermExpenses,
  updateTermExpenses,
  vehicleIdsForTerm,
} from './hooks';
import {
  addTermSchema,
  createPolicySchema,
  updatePolicySchema,
  updateTermSchema,
} from './validation';

const routes = new Hono();

function policyToApi<T extends Record<string, unknown>>(policy: T, scale: number): T {
  const terms = policy.terms;
  if (!Array.isArray(terms)) return policy;
  return {
    ...policy,
    terms: terms.map((t) => insuranceTermToApi(t as Record<string, unknown>, scale)),
  };
}

const ownScale = (c: Context) => repos().preferences.moneyScale(c.get('user').id);

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
>(policy: T, vehicleId: string, seesCosts: boolean) {
  const coveredTermIds = new Set(
    policy.termVehicleCoverage.filter((c) => c.vehicleId === vehicleId).map((c) => c.termId)
  );
  return {
    ...policy,
    terms: policy.terms
      .filter((t) => coveredTermIds.has(t.id))
      .map((t) => {
        if (seesCosts) return t;
        const { totalCost: _total, monthlyCost: _monthly, paymentAmount: _payment, ...term } = t;
        return term;
      }),
    termVehicleCoverage: policy.termVehicleCoverage.filter((c) => c.vehicleId === vehicleId),
    vehicleIds: policy.vehicleIds.filter((v) => v === vehicleId),
  };
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
    const policy = await repos().insurancePolicies.findById(policyId);
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

routes.get('/', authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const policies = await repos().insurancePolicies.findByUserId(user.id);
  const scale = await ownScale(c);
  return c.json({
    success: true,
    data: policies.map((p) => policyToApi(p, scale)),
    count: policies.length,
  });
});

routes.get(
  '/vehicles/:vehicleId/policies',
  zValidator('param', vehiclePoliciesParamSchema),
  authorize(vehicleParam('vehicleId')),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const access = await requireVehicleAccess(vehicleId, user.id, 'read');
    const seesCosts = requestResolver(c).can('vehicle.insurance.read', {
      kind: 'vehicle',
      vehicleId,
    }).allow;
    const policies = await repos().insurancePolicies.findByVehicleId(vehicleId);
    const scoped =
      access.role === 'owner'
        ? policies
        : policies.map((p) => sharedPolicyView(p, vehicleId, seesCosts));
    const scale = await repos().preferences.moneyScale(access.ownerId);
    return c.json({
      success: true,
      data: scoped.map((p) => policyToApi(p, scale)),
      count: scoped.length,
    });
  }
);

routes.post('/', zValidator('json', createPolicySchema), authorize(ownAccount), async (c) => {
  const user = c.get('user');
  const scale = await ownScale(c);
  const body = c.req.valid('json');
  const data = { ...body, terms: body.terms.map((t) => insuranceTermFromApi(t, scale)) };
  for (const term of data.terms) {
    assertTermPremiumWithinCap({ ...term, totalCost: term.totalCost ?? 0 }, scale);
  }
  const policy = await repos().insurancePolicies.create(data, user.id);

  try {
    for (const term of policy.terms) {
      await createTermExpenses(termExpenseParams(policy, term, user.id));
    }
  } catch (error) {
    for (const term of policy.terms) {
      await deleteTermExpenses(term.id, user.id);
    }
    await repos().insurancePolicies.delete(policy.id, user.id);
    throw error;
  }

  return c.json(
    {
      success: true,
      data: policyToApi(policy, scale),
      message: 'Insurance policy created successfully',
    },
    201
  );
});

routes.get('/:id', zValidator('param', idParamSchema), authorize(fromPolicyOwner), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const policy = await validateInsuranceOwnership(id, user.id);
  return c.json({ success: true, data: policyToApi(policy, await ownScale(c)) });
});

routes.put(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updatePolicySchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const data = c.req.valid('json');
    const policy = await repos().insurancePolicies.update(id, data, user.id);
    return c.json({
      success: true,
      data: policyToApi(policy, await ownScale(c)),
      message: 'Insurance policy updated successfully',
    });
  }
);

routes.delete('/:id', zValidator('param', idParamSchema), authorize(fromPolicyOwner), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);

  // Photos have no FK, so they must be removed before the policy cascade orphans them.
  const claims = await repos().insuranceClaims.findByPolicyId(id);
  const claimIds = claims.map((claim) => claim.id);
  await deleteAllPhotosForEntity('insurance_policy', id, user.id);
  await deletePhotosForEntities('insurance_claim', claimIds, user.id);

  // Premium expenses link to terms by text, not FK, so they must be deleted explicitly before the cascade.
  const policyToDelete = await repos().insurancePolicies.findById(id);
  for (const term of policyToDelete?.terms ?? []) {
    await deleteTermExpenses(term.id, user.id);
  }

  await repos().insurancePolicies.delete(id, user.id);
  return c.json({ success: true, message: 'Insurance policy deleted successfully' });
});

routes.post(
  '/:id/terms',
  zValidator('param', idParamSchema),
  zValidator('json', addTermSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const scale = await ownScale(c);
    const termData = insuranceTermFromApi(c.req.valid('json'), scale);
    assertTermPremiumWithinCap({ ...termData, totalCost: termData.totalCost ?? 0 }, scale);
    const policy = await repos().insurancePolicies.addTerm(id, termData, user.id);

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
      await repos().insurancePolicies.deleteTerm(id, policy.newTermId, user.id);
      throw error;
    }

    return c.json(
      {
        success: true,
        data: policyToApi(policy, await ownScale(c)),
        message: 'Term added successfully',
      },
      201
    );
  }
);

routes.put(
  '/:id/terms/:termId',
  zValidator('param', termParamsSchema),
  zValidator('json', updateTermSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id, termId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const scale = await ownScale(c);
    const updates = insuranceTermFromApi(c.req.valid('json'), scale);
    const existing = await repos().insurancePolicies.findById(id);
    const previousTerm = existing?.terms.find((t) => t.id === termId);
    const previous =
      existing && previousTerm ? termExpenseParams(existing, previousTerm, user.id) : undefined;
    if (previous) {
      assertTermPremiumWithinCap(
        {
          totalCost:
            (updates.totalCost === undefined ? previous.totalCost : updates.totalCost) ?? 0,
          monthlyCost:
            updates.monthlyCost === undefined ? previous.monthlyCost : updates.monthlyCost,
          startDate: updates.startDate ?? previous.startDate,
          endDate: updates.endDate ?? previous.endDate,
        },
        scale
      );
    }
    const policy = await repos().insurancePolicies.updateTerm(id, termId, updates, user.id);

    const updatedTerm = policy.terms.find((t) => t.id === termId);
    if (updatedTerm) {
      await updateTermExpenses(termExpenseParams(policy, updatedTerm, user.id), previous);
    }

    return c.json({
      success: true,
      data: policyToApi(policy, await ownScale(c)),
      message: 'Term updated successfully',
    });
  }
);

routes.delete(
  '/:id/terms/:termId',
  zValidator('param', termParamsSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id, termId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);

    // Premium expenses link to terms by text, not FK, so they must be deleted explicitly.
    await deleteTermExpenses(termId, user.id);

    const policy = await repos().insurancePolicies.deleteTerm(id, termId, user.id);
    return c.json({
      success: true,
      data: policyToApi(policy, await ownScale(c)),
      message: 'Term deleted successfully',
    });
  }
);

routes.get(
  '/:id/claims',
  zValidator('param', idParamSchema),
  authorize(fromPolicyReaders),
  async (c) => {
    const { id } = c.req.valid('param');
    const policy = await repos().insurancePolicies.findById(id);
    if (!policy) throw new NotFoundError('Insurance policy');
    const claims = await repos().insuranceClaims.findByPolicyId(id);
    const resolver = await loadResolver(
      c,
      vehicleResources(claims.flatMap((cl) => (cl.vehicleId === null ? [] : [cl.vehicleId])))
    );
    const scoped =
      policy.userId === c.get('user').id
        ? claims
        : claims.filter(
            (cl) =>
              cl.vehicleId !== null &&
              resolver.can('vehicle.insurance.read', { kind: 'vehicle', vehicleId: cl.vehicleId })
                .allow
          );
    const scale = await repos().preferences.moneyScale(policy.userId);
    return c.json({
      success: true,
      data: scoped.map((cl) => insuranceClaimToApi(cl, scale)),
      count: scoped.length,
    });
  }
);

routes.post(
  '/:id/claims',
  zValidator('param', idParamSchema),
  zValidator('json', createClaimSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const data = c.req.valid('json');
    await validateClaimRefs(data, id, user.id);
    const claim = await repos().insuranceClaims.create(
      id,
      insuranceClaimFromApi(data, await ownScale(c))
    );
    return c.json(
      {
        success: true,
        data: insuranceClaimToApi(claim, await ownScale(c)),
        message: 'Claim filed successfully',
      },
      201
    );
  }
);

routes.put(
  '/:id/claims/:claimId',
  zValidator('param', claimParamsSchema),
  zValidator('json', updateClaimSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id, claimId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const updates = c.req.valid('json');
    await validateClaimRefs(updates, id, user.id);
    const claim = await repos().insuranceClaims.update(
      id,
      claimId,
      insuranceClaimFromApi(updates, await ownScale(c))
    );
    return c.json({
      success: true,
      data: insuranceClaimToApi(claim, await ownScale(c)),
      message: 'Claim updated successfully',
    });
  }
);

routes.delete(
  '/:id/claims/:claimId',
  zValidator('param', claimParamsSchema),
  authorize(fromPolicyOwner),
  async (c) => {
    const user = c.get('user');
    const { id, claimId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    await deleteAllPhotosForEntity('insurance_claim', claimId, user.id);
    await repos().insuranceClaims.delete(id, claimId);
    return c.json({ success: true, message: 'Claim deleted successfully' });
  }
);

export { routes };
