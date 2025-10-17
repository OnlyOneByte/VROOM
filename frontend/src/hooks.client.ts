import { goto } from '$app/navigation';
import type { HandleClientError, HandleFetch } from '@sveltejs/kit';

let isRedirecting = false;

// Intercept all fetch requests
export const handleFetch: HandleFetch = async ({ request, fetch }) => {
	const response = await fetch(request);

	// Handle 401 Unauthorized globally
	if (response.status === 401 && !isRedirecting) {
		isRedirecting = true;

		// Import stores dynamically to avoid circular dependencies
		const { authStore } = await import('$lib/stores/auth');
		const { appStore } = await import('$lib/stores/app');

		// Clear auth state
		authStore.clearUser();

		// Show notification
		appStore.addNotification({
			type: 'warning',
			message: 'Your session has expired. Please sign in again.',
			duration: 5000
		});

		// Redirect to auth page
		goto('/auth');

		// Reset flag after delay
		setTimeout(() => {
			isRedirecting = false;
		}, 1000);
	}

	return response;
};

// Optional: Handle client-side errors
export const handleError: HandleClientError = ({ error, event }) => {
	console.error('Client error:', error, event);

	return {
		message: 'An unexpected error occurred'
	};
};
