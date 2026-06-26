import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { ValidationError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { parseClampedInt } from '../../utils/calculations';
import { insuranceClaimToApi, insuranceTermToApi } from '../../utils/money';
import { validateInsuranceOwnership, validateVehicleOwnership } from '../../utils/validation';
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

/**
 * T6 display edge for an insurance policy API object: convert each embedded term's money columns
 * (deductibleAmount/coverageLimit/totalCost/monthlyCost/paymentAmount) from integer CENTS → dollars.
 * The policy row itself carries no money; only its `terms[]` do. Pure, shallow per term.
 */
function policyToApi<T extends Record<string, unknown>>(policy: T): T {
  const terms = policy.terms;
  if (!Array.isArray(terms)) return policy;
  return {
    ...policy,
    terms: terms.map((t) => insuranceTermToApi(t as Record<string, unknown>)),
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

/**
 * Validate a claim's OPTIONAL vehicleId/termId links before a create/update write. The route already
 * proves policy ownership, but the claim schema accepts a free-form `vehicleId` (a cross-tenant FK —
 * the #61/#62 within-tenant-integrity class) and `termId` (which must belong to THIS policy, not another
 * — including another tenant's). The repository wrote both VERBATIM, so without this a user could attach
 * a claim to a vehicle they don't own or a term from a different policy, corrupting claim attribution
 * and planting a cross-tenant reference. Only checks fields that are present (a `null` clear on update is
 * a no-op here). Mirrors the term-vehicle ownership guard (addTerm/updateTerm validateVehicleOwnership).
 */
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

// Apply authentication and change tracking to all routes
routes.use('*', requireAuth);
routes.use('*', changeTracker);

// GET /api/v1/insurance — all policies for authenticated user
routes.get('/', async (c) => {
  const user = c.get('user');
  const policies = await insurancePolicyRepository.findByUserId(user.id);
  // T6 display edge: each policy's embedded term money cents → dollars.
  return c.json({ success: true, data: policies.map(policyToApi), count: policies.length });
});

// GET /api/v1/insurance/expiring-soon — expiring policies
routes.get('/expiring-soon', async (c) => {
  const user = c.get('user');
  // Both params go through parseClampedInt (C211 dedup): a non-numeric value → the fallback, never
  // a NaN that would make `endDate = new Date(now + NaN)` an Invalid Date and silently empty the
  // result (#70). `days` → 30-day default, clamped 1..366; `limit` → 100, clamped 1..200.
  const daysAhead = parseClampedInt(c.req.query('days'), 30, 1, 366);
  const limit = parseClampedInt(c.req.query('limit'), 100, 1, 200);
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const terms = await insurancePolicyRepository.findExpiringTerms(now, endDate, user.id, limit);
  // T6 display edge: these are bare term rows (money cents → dollars).
  return c.json({
    success: true,
    data: terms.map((t) => insuranceTermToApi(t)),
    count: terms.length,
    daysAhead,
    limit,
  });
});

// GET /api/v1/insurance/vehicles/:vehicleId/policies — policies for a vehicle
routes.get(
  '/vehicles/:vehicleId/policies',
  zValidator('param', vehiclePoliciesParamSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    await validateVehicleOwnership(vehicleId, user.id);
    const policies = await insurancePolicyRepository.findByVehicleId(vehicleId);
    return c.json({ success: true, data: policies.map(policyToApi), count: policies.length });
  }
);

// POST /api/v1/insurance — create policy
routes.post('/', zValidator('json', createPolicySchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const policy = await insurancePolicyRepository.create(data, user.id);

  // Auto-create split expenses for each term that has a cost (totalCost OR a monthly premium, #69).
  // The hook computes the effective total (createTermExpenses → effectiveTermCost) and no-ops on 0.
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

// GET /api/v1/insurance/:id — single policy
routes.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const policy = await validateInsuranceOwnership(id, user.id);
  return c.json({ success: true, data: policyToApi(policy) });
});

// PUT /api/v1/insurance/:id — update policy
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

// DELETE /api/v1/insurance/:id — delete policy
routes.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);

  // Clean photos (provider files + DB) BEFORE deleting the policy. Deleting the
  // policy FK-cascades its claims, but the photos table has no FK — so the
  // policy's own documents AND its claims' documents (rows + external storage
  // files) would orphan. Enumerate the claims while they still exist.
  const claims = await insuranceClaimRepository.findByPolicyId(id);
  const claimIds = claims.map((claim) => claim.id);
  await deleteAllPhotosForEntity('insurance_policy', id, user.id);
  await deletePhotosForEntities('insurance_claim', claimIds, user.id);

  // Clean the auto-materialized premium expenses too (#57). Each costed term spawned a split expense
  // (hooks.ts createTermExpenses, sourceType:'insurance_term', sourceId:termId), but expenses link to
  // terms by plain text columns, NOT an FK — so the term cascade-delete below leaves those expense rows
  // ORPHANED, still summed into TCO insurance cost forever (analytics categorizes any financial +
  // sourceType:'insurance_term' row, with no term-exists check) and leaking their own expense photos.
  // DELETE-term + UPDATE-term already deleteBySource these; the parent-policy delete was the one gap.
  // Enumerate the policy's terms while they still exist, mirroring the claim-photo cleanup above.
  const policyToDelete = await insurancePolicyRepository.findById(id);
  for (const term of policyToDelete?.terms ?? []) {
    await expenseRepository.deleteBySource('insurance_term', term.id, user.id);
  }

  await insurancePolicyRepository.delete(id, user.id);
  return c.json({ success: true, message: 'Insurance policy deleted successfully' });
});

// POST /api/v1/insurance/:id/terms — add term (flat fields)
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

    // Auto-create split expenses if the new term has a cost (totalCost OR a monthly premium, #69).
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

// PUT /api/v1/insurance/:id/terms/:termId — update term (flat fields)
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

    // Sync auto-created expenses with updated term data
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

// DELETE /api/v1/insurance/:id/terms/:termId — delete term
routes.delete('/:id/terms/:termId', zValidator('param', termParamsSchema), async (c) => {
  const user = c.get('user');
  const { id, termId } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);

  // Delete auto-created expenses before deleting the term (FK cascade is gone)
  await expenseRepository.deleteBySource('insurance_term', termId, user.id);

  const policy = await insurancePolicyRepository.deleteTerm(id, termId, user.id);
  return c.json({ success: true, data: policyToApi(policy), message: 'Term deleted successfully' });
});

// --- Claims (filed against a policy) ---

// GET /api/v1/insurance/:id/claims — list claims for a policy
routes.get('/:id/claims', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);
  const claims = await insuranceClaimRepository.findByPolicyId(id);
  // T6 display edge: each claim's payoutAmount cents → dollars.
  return c.json({
    success: true,
    data: claims.map((cl) => insuranceClaimToApi(cl)),
    count: claims.length,
  });
});

// POST /api/v1/insurance/:id/claims — file a claim
routes.post(
  '/:id/claims',
  zValidator('param', idParamSchema),
  zValidator('json', createClaimSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const data = c.req.valid('json');
    // Validate the optional vehicleId/termId links (owned vehicle; term on THIS policy) — the route
    // only proved policy ownership, and the repo writes these FKs verbatim.
    await validateClaimRefs(data, id, user.id);
    const claim = await insuranceClaimRepository.create(id, data);
    return c.json(
      { success: true, data: insuranceClaimToApi(claim), message: 'Claim filed successfully' },
      201
    );
  }
);

// PUT /api/v1/insurance/:id/claims/:claimId — update a claim
routes.put(
  '/:id/claims/:claimId',
  zValidator('param', claimParamsSchema),
  zValidator('json', updateClaimSchema),
  async (c) => {
    const user = c.get('user');
    const { id, claimId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const updates = c.req.valid('json');
    // Re-validate a CHANGED vehicleId/termId link (mirror the create-path guard).
    await validateClaimRefs(updates, id, user.id);
    const claim = await insuranceClaimRepository.update(id, claimId, updates);
    return c.json({
      success: true,
      data: insuranceClaimToApi(claim),
      message: 'Claim updated successfully',
    });
  }
);

// DELETE /api/v1/insurance/:id/claims/:claimId — delete a claim
routes.delete('/:id/claims/:claimId', zValidator('param', claimParamsSchema), async (c) => {
  const user = c.get('user');
  const { id, claimId } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);
  // Clean the claim's documents (provider files + DB) before deleting the row.
  await deleteAllPhotosForEntity('insurance_claim', claimId, user.id);
  await insuranceClaimRepository.delete(id, claimId);
  return c.json({ success: true, message: 'Claim deleted successfully' });
});

export { routes };
