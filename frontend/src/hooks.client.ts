import type { HandleClientError } from '@sveltejs/kit';

// Only handleError and init are read from this module; 401 handling lives in api-client.ts.
export const handleError: HandleClientError = ({ error, event }) => {
	if (import.meta.env.DEV) {
		console.error('Client error:', error, event);
	}

	return {
		message: 'An unexpected error occurred'
	};
};
