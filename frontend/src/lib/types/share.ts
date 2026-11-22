export type ShareLevel = 'viewer' | 'editor';
type ShareStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface VehicleShare {
	id: string;
	vehicleId: string;
	ownerId: string;
	sharedWithId: string | null;
	level: ShareLevel;
	status: ShareStatus;
	createdAt: string;
	updatedAt: string;
}

export interface GrantedShare extends VehicleShare {
	sharedWithEmail: string | null;
	sharedWithName: string | null;
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
