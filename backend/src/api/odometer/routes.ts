import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { NotFoundError } from '../../errors';
import { changeTracker, requireAuth } from '../../middleware';
import { buildPaginatedResponse, clampPagination } from '../../utils/pagination';
import {
  requireVehicleRead,
  requireVehicleWrite,
  resolveVehicleOwnerId,
} from '../../utils/sharing';
import { commonSchemas } from '../../utils/validation';
import { deleteAllPhotosForEntity } from '../photos/photo-service';
import { reminderTriggerService } from '../reminders/trigger-service';
import { odometerRepository } from './repository';

const routes = new Hono();

// --- Zod schemas ---

const createSchema = z.object({
  odometer: z.number().int().min(0, 'Odometer must be a non-negative integer'),
  recordedAt: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date cannot be in the future' }),
  note: z.string().max(500).optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  ...commonSchemas.clampedPaginationFields,
});

// --- Middleware ---

routes.use('*', requireAuth);
routes.use('*', changeTracker);

// --- Routes ---

// GET /:vehicleId — list entries for a vehicle (paginated)
routes.get(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    // vehicle-sharing T6 READ widening (design §2.1 rule 3, the odometer analogue of T5b-3). Gate via
    // requireVehicleRead (owner | accepted viewer/editor | 404), then scope the query to the vehicle
    // OWNER's userId — odometer rows are owner-stamped (T6 WRITE), so a shared invitee querying their
    // OWN userId would see nothing. With vehicleId AND ownerId pinned, the result is exactly this
    // vehicle's entries (the owner cannot leak OTHER vehicles); an owner reading their own is unchanged.
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await odometerRepository.findByVehicleIdPaginated(
      vehicleId,
      ownerId,
      limit,
      offset
    );

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

// GET /:vehicleId/history — unified odometer history (UNION of expenses + manual entries)
routes.get(
  '/:vehicleId/history',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('query', listQuerySchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const query = c.req.valid('query');

    // T6 READ widening: shared READ access, scoped to the vehicle OWNER's books (the history UNION
    // over expenses+odometer_entries is userId-scoped; both source legs are owner-stamped on a shared
    // vehicle). See the list note above.
    await requireVehicleRead(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

    const { limit, offset } = clampPagination(query);

    const { data, totalCount } = await odometerRepository.getHistory(vehicleId, ownerId, {
      limit,
      offset,
    });

    return c.json(buildPaginatedResponse(data, totalCount, limit, offset));
  }
);

// GET /entry/:id — get a single entry by ID
routes.get('/entry/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // T6 READ widening: load the (owner-stamped) entry UNSCOPED, then authorize via the vehicle's READ
  // access. A stranger gets the same NotFoundError the absent-row branch throws (existence-hiding), so
  // a shared invitee reads a single shared-vehicle odometer entry while a third party cannot.
  const entry = await odometerRepository.findById(id);
  if (!entry) throw new NotFoundError('Odometer entry');
  await requireVehicleRead(entry.vehicleId, user.id);

  return c.json({ success: true, data: entry });
});

// POST /:vehicleId — create manual entry
routes.post(
  '/:vehicleId',
  zValidator('param', commonSchemas.vehicleIdParam),
  zValidator('json', createSchema),
  async (c) => {
    const user = c.get('user');
    const { vehicleId } = c.req.valid('param');
    const data = c.req.valid('json');

    // vehicle-sharing T6 WRITE widening: owner OR accepted editor (viewer/stranger → same 404). Then
    // OWNER-STAMP the userId (design §2.1 rule 1, the odometer analogue of the expense owner-stamp): an
    // editor's reading rides the OWNER's books so it counts in the owner's mileage/getCurrentOdometer +
    // backup, not the editor's. Odometer rows have NO createdBy column (they are not money rows — only
    // the expenses provenance migration added one), so the owner-stamp is via userId alone. An owner
    // writing their own vehicle resolves to themselves (unchanged). requireVehicleWrite 404'd an absent
    // vehicle, so the owner id is always present here.
    await requireVehicleWrite(vehicleId, user.id);
    const ownerId = await resolveVehicleOwnerId(vehicleId);
    if (!ownerId) throw new NotFoundError('Vehicle');

    const entry = await odometerRepository.create({
      vehicleId,
      userId: ownerId,
      odometer: data.odometer,
      recordedAt: data.recordedAt,
      note: data.note ?? null,
    });

    // D5: a new reading may have crossed a mileage reminder's milestone — re-check this vehicle's
    // mileage reminders now so the notification fires immediately, not only on the next /trigger.
    // Scope to the OWNER (the reminders for this vehicle belong to the owner, not a shared editor).
    // Best-effort (recheck never throws); the reading is already persisted.
    await reminderTriggerService.recheckMileageReminders(ownerId, vehicleId);

    return c.json({ success: true, data: entry, message: 'Odometer reading created' }, 201);
  }
);

// PUT /:id — update a manual entry
routes.put(
  '/:id',
  zValidator('param', commonSchemas.idParam),
  zValidator('json', updateSchema),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');

    // T6 WRITE widening: load the (owner-stamped) entry UNSCOPED — the old validateOdometerOwnership(id,
    // acting) would 404 a shared editor's edit of an owner-stamped row — then authorize via the vehicle's
    // WRITE access (owner | editor; viewer/stranger → same 404). The update never changes userId, so the
    // owner-stamp invariant (userId == vehicle owner) holds across the edit.
    const existing = await odometerRepository.findById(id);
    if (!existing) throw new NotFoundError('Odometer entry');
    await requireVehicleWrite(existing.vehicleId, user.id);

    const updated = await odometerRepository.update(id, {
      ...data,
      updatedAt: new Date(),
    });

    // D5 (#71): editing a reading can cross a mileage milestone (e.g. correcting an odometer upward
    // past a reminder's due value). Mirror the create-path best-effort recheck (never throws,
    // idempotent via the dedup), scoped to the OWNER (existing.userId — the row owner; the mileage
    // reminders for this vehicle belong to the owner, not a shared editor).
    await reminderTriggerService.recheckMileageReminders(existing.userId, updated.vehicleId);

    return c.json({ success: true, data: updated, message: 'Odometer reading updated' });
  }
);

// DELETE /:id — delete a manual entry
routes.delete('/:id', zValidator('param', commonSchemas.idParam), async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');

  // T6 WRITE widening: load the (owner-stamped) entry UNSCOPED, then authorize via the vehicle's WRITE
  // access (owner | editor; viewer/stranger → same 404). An editor may delete a reading on a shared
  // vehicle. Scope the photo-ownership cleanup to the row OWNER (existing.userId — odometer photos
  // validate via odometer_entries.userId = owner, so the acting editor would 404 the cleanup).
  const existing = await odometerRepository.findById(id);
  if (!existing) throw new NotFoundError('Odometer entry');
  await requireVehicleWrite(existing.vehicleId, user.id);

  await deleteAllPhotosForEntity('odometer_entry', id, existing.userId);
  await odometerRepository.delete(id);

  return c.json({ success: true, message: 'Odometer reading deleted' });
});

export { routes };
