import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { PolicyTerm } from '../../db/schema';
import { changeTracker, requireAuth } from '../../middleware';
import { validateInsuranceOwnership, validateVehicleOwnership } from '../../utils/validation';
import type { TermVehicleCoverage } from './repository';
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

/**
 * Convert Zod-coerced Date objects in a term back to ISO strings
 * so they match the PolicyTerm interface expected by the repository.
 * Preserves vehicleCoverage for per-term vehicle assignment.
 */
function toStorableTerm(term: {
  id: string;
  startDate: Date;
  endDate: Date;
  policyDetails?: Record<string, unknown>;
  financeDetails?: Record<string, unknown>;
  vehicleCoverage: TermVehicleCoverage;
}): PolicyTerm & { vehicleCoverage: TermVehicleCoverage } {
  return {
    ...term,
    startDate: term.startDate.toISOString(),
    endDate: term.endDate.toISOString(),
  } as PolicyTerm & { vehicleCoverage: TermVehicleCoverage };
}

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
  const user = c.get('user');
  const daysAhead = Number.parseInt(c.req.query('days') || '30', 10);
  const policies = await insurancePolicyRepository.findExpiringPolicies(user.id, daysAhead);
  return c.json({ success: true, data: policies, count: policies.length, daysAhead });
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
  const policy = await insurancePolicyRepository.create(
    { ...data, terms: data.terms.map(toStorableTerm) },
    user.id
  );
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

// POST /api/v1/insurance/:id/terms — add term
routes.post(
  '/:id/terms',
  zValidator('param', idParamSchema),
  zValidator('json', addTermSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const termData = c.req.valid('json');
    const policy = await insurancePolicyRepository.addTerm(id, toStorableTerm(termData), user.id);
    return c.json({ success: true, data: policy, message: 'Term added successfully' }, 201);
  }
);

// PUT /api/v1/insurance/:id/terms/:termId — update term
routes.put(
  '/:id/terms/:termId',
  zValidator('param', termParamsSchema),
  zValidator('json', updateTermSchema),
  async (c) => {
    const user = c.get('user');
    const { id, termId } = c.req.valid('param');
    await validateInsuranceOwnership(id, user.id);
    const { startDate, endDate, vehicleCoverage, ...rest } = c.req.valid('json');
    const converted: Partial<PolicyTerm> & { vehicleCoverage?: TermVehicleCoverage } = {
      ...rest,
      ...(startDate && { startDate: startDate.toISOString() }),
      ...(endDate && { endDate: endDate.toISOString() }),
      ...(vehicleCoverage && { vehicleCoverage }),
    };
    const policy = await insurancePolicyRepository.updateTerm(id, termId, converted, user.id);
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
