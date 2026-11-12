export type ShareLevel = 'viewer' | 'editor';
export type ShareStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

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

export interface ReceivedShare extends VehicleShare {
	vehicleName: string;
	sharedBy: string;
}

export interface SharedAccess {
	level: ShareLevel;
	sharedBy: string;
}
