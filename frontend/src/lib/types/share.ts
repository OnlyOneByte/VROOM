/** Vehicle-share types, mirroring the backend vehicle_shares row and the /api/v1/shares contract. */

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

export interface CreateShareRequest {
	vehicleId: string;
	email: string;
	level: ShareLevel;
}

/** A share as seen by the invitee, with display names so pending invites can be labelled. */
export interface ReceivedShare extends VehicleShare {
	/** nickname, else "year make model". */
	vehicleName: string;
	/** Same field as SharedAccess.sharedBy. */
	sharedBy: string;
}

/** Present only on shared rows from `/api/v1/vehicles?include=shared`; owned vehicles have none. */
export interface SharedAccess {
	level: ShareLevel;
	sharedBy: string;
}
