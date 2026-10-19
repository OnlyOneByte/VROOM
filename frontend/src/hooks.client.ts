import type { HandleClientError } from '@sveltejs/kit';

/**
 * Last-resort reporter for an uncaught client-side error. The generated client manifest reads only
 * `handleError` and `init` from this module, so nothing else belongs here — in particular
 * `handleFetch` is a SERVER hook and a copy of it living here never ran. The app's global 401
 * handling therefore lives in `api-client.ts`, which is the one place app code reaches the network.
 */
export const handleError: HandleClientError = ({ error, event }) => {
	if (import.meta.env.DEV) {
		console.error('Client error:', error, event);
	}

	return {
		message: 'An unexpected error occurred'
	};
};
