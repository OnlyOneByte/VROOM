import type { Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';

export const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin'
};

export const HSTS = 'max-age=31536000; includeSubDomains';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	if (!dev && !response.headers.has('Strict-Transport-Security')) {
		response.headers.set('Strict-Transport-Security', HSTS);
	}
	return response;
};
