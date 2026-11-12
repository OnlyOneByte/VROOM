import type { HandleClientError } from '@sveltejs/kit/hooks';

export const handleError: HandleClientError = ({ error, event, kind }) => {
	if (kind !== 'unknown') return;

	if (import.meta.env.DEV) {
		console.error('Client error:', error, event);
	}

	return {
		message: 'An unexpected error occurred'
	};
};
