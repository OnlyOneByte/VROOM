import type { PageLoad } from './$types';

export const load: PageLoad = ({ params, url }) => {
	const tab = url.searchParams.get('tab');
	return {
		vehicleId: params.id,
		...(tab ? { tab } : {})
	};
};
