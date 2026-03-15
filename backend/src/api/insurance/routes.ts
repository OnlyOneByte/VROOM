import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { changeTracker, requireAuth } from '../../middleware';
import { validateInsuranceOwnership, validateVehicleOwnership } from '../../utils/validation';
import { createTermExpenses, updateTermExpenses } from './hooks';
import { insurancePolicyRepository } from './repository';
import {
  addTermSchema,
  createPolicySchema,
  updatePolicySchema,
  updateTermSchema,
} from './validation';

const routes = new Hono();

const idParamSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
});

const termParamsSchema = z.object({
  id: z.string().min(1, 'Insurance policy ID is required'),
  termId: z.string().min(1, 'Term ID is required'),
});

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
  return c.json({ success: true, data: policies, count: policies.length });
});

// GET /api/v1/insurance/expiring-soon — expiring policies
routes.get('/expiring-soon', async (c) => {
  const _user = c.get('user');
  const daysAhead = Number.parseInt(c.req.query('days') || '30', 10);
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const terms = await insurancePolicyRepository.findExpiringTerms(now, endDate);
  return c.json({ success: true, data: terms, count: terms.length, daysAhead });
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
    return c.json({ success: true, data: policies, count: policies.length });
  }
);

// POST /api/v1/insurance — create policy
routes.post('/', zValidator('json', createPolicySchema), async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const policy = await insurancePolicyRepository.create(data, user.id);

  // Auto-create split expenses for each term that has a totalCost
  for (const term of policy.terms) {
    if (term.totalCost && term.totalCost > 0) {
      const termVehicleIds = policy.termVehicleCoverage
        .filter((tc) => tc.termId === term.id)
        .map((tc) => tc.vehicleId);
      await createTermExpenses({
        termId: term.id,
        vehicleIds: termVehicleIds,
        totalCost: term.totalCost,
        startDate: term.startDate,
        policyNumber: term.policyNumber ?? undefined,
        userId: user.id,
      });
    }
  }

  return c.json(
    { success: true, data: policy, message: 'Insurance policy created successfully' },
    201
  );
});

// GET /api/v1/insurance/:id — single policy
routes.get('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const policy = await validateInsuranceOwnership(id, user.id);
  return c.json({ success: true, data: policy });
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
      data: policy,
      message: 'Insurance policy updated successfully',
    });
  }
);

// DELETE /api/v1/insurance/:id — delete policy
routes.delete('/:id', zValidator('param', idParamSchema), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);
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

    // Auto-create split expenses if the new term has a totalCost
    if (termData.totalCost && termData.totalCost > 0) {
      // Find the newly added term (latest by createdAt)
      const newTerm = policy.terms.find(
        (t) =>
          t.policyNumber === (termData.policyNumber ?? null) &&
          t.totalCost === termData.totalCost &&
          t.startDate.getTime() === termData.startDate.getTime()
      );
      if (newTerm) {
        const termVehicleIds = policy.termVehicleCoverage
          .filter((tc) => tc.termId === newTerm.id)
          .map((tc) => tc.vehicleId);
        await createTermExpenses({
          termId: newTerm.id,
          vehicleIds: termVehicleIds,
          totalCost: termData.totalCost,
          startDate: termData.startDate,
          policyNumber: termData.policyNumber,
          userId: user.id,
        });
      }
    }

    return c.json({ success: true, data: policy, message: 'Term added successfully' }, 201);
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
      const termVehicleIds = policy.termVehicleCoverage
        .filter((tc) => tc.termId === termId)
        .map((tc) => tc.vehicleId);
      await updateTermExpenses({
        termId,
        vehicleIds: termVehicleIds,
        totalCost: updatedTerm.totalCost ?? 0,
        startDate: updatedTerm.startDate,
        policyNumber: updatedTerm.policyNumber ?? undefined,
        userId: user.id,
      });
    }

    return c.json({ success: true, data: policy, message: 'Term updated successfully' });
  }
);

// DELETE /api/v1/insurance/:id/terms/:termId — delete term
routes.delete('/:id/terms/:termId', zValidator('param', termParamsSchema), async (c) => {
  const user = c.get('user');
  const { id, termId } = c.req.valid('param');
  await validateInsuranceOwnership(id, user.id);
  const policy = await insurancePolicyRepository.deleteTerm(id, termId, user.id);
  return c.json({ success: true, data: policy, message: 'Term deleted successfully' });
});

export { routes };
