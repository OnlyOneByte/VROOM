import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { routes } from '#lib/routes.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	redirect(307, resolve(routes.dashboard));
};
