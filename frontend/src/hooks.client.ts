import type { HandleClientError } from '@sveltejs/kit';

export const handleError: HandleClientError = ({ error, event }) => {
	if (import.meta.env.DEV) {
		console.error('Client error:', error, event);
	}

	return {
		message: 'An unexpected error occurred'
	};
};
