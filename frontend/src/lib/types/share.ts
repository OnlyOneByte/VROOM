/**
 * Vehicle-sharing types (vehicle-sharing T10 FE seam) — mirror the backend `vehicle_shares` row + the
 * `/api/v1/shares` contract (owner-side T3 + invitee-side T4). An owner grants another VROOM user
 * scoped access (viewer|editor) to one vehicle; the invitee accepts/declines.
 */

export type ShareLevel = 'viewer' | 'editor';
export type ShareStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

/** A vehicle-share row as returned by the share endpoints. */
export interface VehicleShare {
	id: string;
	vehicleId: string;
	ownerId: string;
	sharedWithId: string;
	level: ShareLevel;
	status: ShareStatus;
	createdAt: string;
	updatedAt: string;
}

/** Owner invites an existing user (by email) to a vehicle they own. */
export interface CreateShareRequest {
	vehicleId: string;
	email: string;
	level: ShareLevel;
}

/**
 * A share RECEIVED by an invitee, as returned by `GET /api/v1/shares/received` (T12). The backend
 * enriches the raw share row with the vehicle's display name + the owner's name so the "Shared with
 * me" surface can label a still-PENDING invite (which the accepted-only fleet widening cannot show).
 */
export interface ReceivedShare extends VehicleShare {
	/** nickname, else "year make model". */
	vehicleName: string;
	/** The owner's display name (matches T5a's SharedAccess.sharedBy). */
	sharedBy: string;
}

/**
 * The `sharedAccess` annotation a vehicle row carries when it appears in the fleet list via
 * `GET /api/v1/vehicles?include=shared` (T5a): which level the acting user has + who shared it.
 * Present ONLY on shared rows; an owned vehicle has no `sharedAccess`.
 */
export interface SharedAccess {
	level: ShareLevel;
	sharedBy: string;
}
