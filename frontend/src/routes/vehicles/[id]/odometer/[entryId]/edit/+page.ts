import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		vehicleId: params.id,
		entryId: params.entryId
	};
};
