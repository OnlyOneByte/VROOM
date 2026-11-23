import { goto } from '$app/navigation';
import { page } from '$app/state';
import { browser } from '$app/env';
import { apiClient, getApiBaseUrl } from '#lib/services/api-client.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';

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

export function useGoogleOAuth(getOptions: () => GoogleOAuthOptions): GoogleOAuthReturn {
	let pendingEmail = $state('');
	let oauthNonce = $state('');

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
		window.location.href = `${getApiBaseUrl()}/auth/providers/connect/google?${params.toString()}`;
	}

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
					// Corrupt stored state: keep the defaults.
				}
			}

			try {
				const result = await apiClient.get<{ email: string }>(`/providers/pending/${nonceParam}`);
				pendingEmail = result.email;
			} catch (error) {
				const reason =
					error instanceof ApiError && error.statusCode === 404
						? 'Connect it again.'
						: userFacingErrorMessage(error);
				appStore.showError(`Couldn't find the Google account you connected. ${reason}`);
			}

			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic runtime path from current URL
			goto(page.url.pathname, { replace: true });

			return { restoredSelectedType, restoredDisplayName };
		}

		if (providerError) {
			const errorMessages: Record<string, string> = {
				cancelled: 'Google account connection was cancelled.',
				exchange_failed: "Couldn't connect your Google account. Try again.",
				no_refresh_token: 'Google did not grant offline access. Please try again.',
				session_expired: 'Your session expired. Please log in and try again.',
				invalid_state: 'The Google connection expired. Please try again.',
				session_mismatch:
					'You were signed in as someone else when Google finished connecting. Sign in again and retry.'
			};
			appStore.showError(
				errorMessages[providerError] ?? "Couldn't connect your Google account. Try again."
			);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic runtime path from current URL
			goto(page.url.pathname, { replace: true });
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
