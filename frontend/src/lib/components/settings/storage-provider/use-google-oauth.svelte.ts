import { goto } from '$app/navigation';
import { page } from '$app/state';
import { browser } from '$app/environment';
import { apiClient, getApiBaseUrl } from '$lib/services/api-client';
import { appStore } from '$lib/stores/app.svelte';

interface GoogleOAuthOptions {
	isEditMode: boolean;
	providerId?: string;
	existingEmail?: string;
	displayName: string;
	selectedType: string | null;
}

interface GoogleOAuthState {
	pendingEmail: string;
	oauthNonce: string;
}

interface GoogleOAuthReturn extends GoogleOAuthState {
	startGoogleOAuth: () => void;
	handleOAuthReturn: () => Promise<{
		restoredSelectedType?: string;
		restoredDisplayName?: string;
	}>;
	restoreFormState: () => { selectedType?: string; displayName?: string } | null;
}

/** Google Drive OAuth flow; form state survives the redirect via sessionStorage. */
export function useGoogleOAuth(getOptions: () => GoogleOAuthOptions): GoogleOAuthReturn {
	let pendingEmail = $state('');
	let oauthNonce = $state('');

	/** Call synchronously during component init, outside onMount. */
	function restoreFormState(): { selectedType?: string; displayName?: string } | null {
		if (!browser) return null;
		const saved = sessionStorage.getItem('provider-form-state');
		if (!saved) return null;
		sessionStorage.removeItem('provider-form-state');
		try {
			return JSON.parse(saved) as { selectedType?: string; displayName?: string };
		} catch {
			return null;
		}
	}

	function startGoogleOAuth() {
		const opts = getOptions();
		const nonce = crypto.randomUUID();
		const returnTo = opts.isEditMode
			? `/settings/providers/${opts.providerId}/edit`
			: '/settings/providers/new';
		sessionStorage.setItem(
			'provider-form-state',
			JSON.stringify({
				selectedType: opts.selectedType ?? 'google-drive',
				displayName: opts.displayName,
				nonce
			})
		);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- used inside non-reactive function, not tracked
		const params = new URLSearchParams({ returnTo, nonce });
		if (opts.isEditMode && opts.providerId) params.set('providerId', opts.providerId);
		if (opts.isEditMode && opts.existingEmail) {
			params.set('email', opts.existingEmail);
		}
		window.location.href = `${getApiBaseUrl()}/api/v1/auth/providers/connect/google?${params.toString()}`;
	}

	/** Call from onMount. Returns restored form state only when the OAuth flow completed. */
	async function handleOAuthReturn(): Promise<{
		restoredSelectedType?: string;
		restoredDisplayName?: string;
	}> {
		const params = page.url.searchParams;
		const providerConnected = params.get('provider_connected');
		const providerError = params.get('provider_error');
		const nonceParam = params.get('nonce');

		if (providerConnected === 'true' && nonceParam) {
			oauthNonce = nonceParam;

			let restoredSelectedType: string | undefined;
			let restoredDisplayName: string | undefined;
			const saved = sessionStorage.getItem('provider-form-state');
			if (saved) {
				sessionStorage.removeItem('provider-form-state');
				try {
					const parsed = JSON.parse(saved) as {
						selectedType?: string;
						displayName?: string;
						nonce?: string;
					};
					restoredSelectedType = parsed.selectedType;
					restoredDisplayName = parsed.displayName;
				} catch {
					// ignore
				}
			}

			try {
				const result = await apiClient.get<{ email: string }>(
					`/api/v1/providers/pending/${nonceParam}`
				);
				pendingEmail = result.email;
			} catch {
				appStore.showError('Failed to retrieve connected Google account. Please try again.');
			}

			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic runtime path from current URL
			goto(page.url.pathname, { replaceState: true });

			return { restoredSelectedType, restoredDisplayName };
		}

		if (providerError) {
			const errorMessages: Record<string, string> = {
				cancelled: 'Google account connection was cancelled.',
				exchange_failed: 'Failed to connect Google account. Please try again.',
				no_refresh_token: 'Google did not grant offline access. Please try again.',
				session_expired: 'Your session expired. Please log in and try again.'
			};
			appStore.showError(
				errorMessages[providerError] ?? 'An error occurred connecting your Google account.'
			);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic runtime path from current URL
			goto(page.url.pathname, { replaceState: true });
		}

		return {};
	}

	return {
		get pendingEmail() {
			return pendingEmail;
		},
		get oauthNonce() {
			return oauthNonce;
		},
		startGoogleOAuth,
		handleOAuthReturn,
		restoreFormState
	};
}
