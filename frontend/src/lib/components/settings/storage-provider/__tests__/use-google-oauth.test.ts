import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const { goto, page, get, showError } = vi.hoisted(() => ({
	goto: vi.fn(),
	page: { url: new URL('https://app.example/settings/providers/new') },
	get: vi.fn(),
	showError: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page }));
vi.mock('#lib/services/api-client.ts', () => ({
	apiClient: { get },
	getApiBaseUrl: () => 'https://api.example/api/v1'
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { showError } }));

const { useGoogleOAuth } = await import('../use-google-oauth.svelte');

const FORM_KEY = 'provider-form-state';
const originalLocation = window.location;
let assignedHref = '';

type OAuthOptions = ReturnType<Parameters<typeof useGoogleOAuth>[0]>;

function createOAuth(overrides: Partial<OAuthOptions> = {}) {
	return useGoogleOAuth(() => ({
		isEditMode: false,
		displayName: 'My Drive',
		selectedType: null,
		...overrides
	}));
}

function setPageUrl(url: string) {
	page.url = new URL(url);
}

beforeEach(() => {
	vi.clearAllMocks();
	sessionStorage.clear();
	assignedHref = '';
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: {
			get href() {
				return assignedHref;
			},
			set href(value: string) {
				assignedHref = value;
			}
		}
	});
	vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-3333-4444-555555555555');
	setPageUrl('https://app.example/settings/providers/new');
});

afterEach(() => {
	Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
	vi.restoreAllMocks();
});

describe('restoreFormState', () => {
	test('returns null when nothing was saved', () => {
		expect(createOAuth().restoreFormState()).toBeNull();
	});

	test('returns and consumes the saved form state', () => {
		sessionStorage.setItem(
			FORM_KEY,
			JSON.stringify({ selectedType: 'google-drive', displayName: 'D' })
		);
		const oauth = createOAuth();
		expect(oauth.restoreFormState()).toEqual({ selectedType: 'google-drive', displayName: 'D' });
		expect(sessionStorage.getItem(FORM_KEY)).toBeNull();
	});

	test('returns null for corrupt saved state and still clears it', () => {
		sessionStorage.setItem(FORM_KEY, '{not json');
		expect(createOAuth().restoreFormState()).toBeNull();
		expect(sessionStorage.getItem(FORM_KEY)).toBeNull();
	});
});

describe('startGoogleOAuth', () => {
	test('a new provider saves the form and redirects with a nonce and the new-provider return path', () => {
		createOAuth().startGoogleOAuth();
		expect(JSON.parse(sessionStorage.getItem(FORM_KEY) ?? '{}')).toEqual({
			selectedType: 'google-drive',
			displayName: 'My Drive',
			nonce: '11111111-2222-3333-4444-555555555555'
		});
		const url = new URL(assignedHref);
		expect(url.origin + url.pathname).toBe(
			'https://api.example/api/v1/auth/providers/connect/google'
		);
		expect(url.searchParams.get('returnTo')).toBe('/settings/providers/new');
		expect(url.searchParams.get('nonce')).toBe('11111111-2222-3333-4444-555555555555');
		expect(url.searchParams.has('providerId')).toBe(false);
		expect(url.searchParams.has('email')).toBe(false);
	});

	test('edit mode returns to the edit page and passes the provider id and existing email', () => {
		createOAuth({
			isEditMode: true,
			providerId: 'prov-9',
			existingEmail: 'me@example.com',
			selectedType: 'google-sheets'
		}).startGoogleOAuth();
		const url = new URL(assignedHref);
		expect(url.searchParams.get('returnTo')).toBe('/settings/providers/prov-9/edit');
		expect(url.searchParams.get('providerId')).toBe('prov-9');
		expect(url.searchParams.get('email')).toBe('me@example.com');
		expect(JSON.parse(sessionStorage.getItem(FORM_KEY) ?? '{}').selectedType).toBe('google-sheets');
	});

	test('edit mode without an existing email omits the email hint', () => {
		createOAuth({ isEditMode: true, providerId: 'prov-9' }).startGoogleOAuth();
		expect(new URL(assignedHref).searchParams.has('email')).toBe(false);
	});
});

describe('handleOAuthReturn', () => {
	test('does nothing on a normal page load', async () => {
		const oauth = createOAuth();
		await expect(oauth.handleOAuthReturn()).resolves.toEqual({});
		expect(goto).not.toHaveBeenCalled();
		expect(showError).not.toHaveBeenCalled();
	});

	test('a successful connect restores the form, fetches the pending email and cleans the URL', async () => {
		setPageUrl('https://app.example/settings/providers/new?provider_connected=true&nonce=n-1');
		sessionStorage.setItem(
			FORM_KEY,
			JSON.stringify({ selectedType: 'google-drive', displayName: 'Backups', nonce: 'n-1' })
		);
		get.mockResolvedValue({ email: 'me@example.com' });
		const oauth = createOAuth();
		await expect(oauth.handleOAuthReturn()).resolves.toEqual({
			restoredSelectedType: 'google-drive',
			restoredDisplayName: 'Backups'
		});
		expect(get).toHaveBeenCalledWith('/providers/pending/n-1');
		expect(oauth.pendingEmail).toBe('me@example.com');
		expect(oauth.oauthNonce).toBe('n-1');
		expect(sessionStorage.getItem(FORM_KEY)).toBeNull();
		expect(goto).toHaveBeenCalledWith('/settings/providers/new', { replace: true });
	});

	test('a successful connect with corrupt or missing saved state returns no restored values', async () => {
		setPageUrl('https://app.example/settings/providers/new?provider_connected=true&nonce=n-2');
		sessionStorage.setItem(FORM_KEY, 'garbage');
		get.mockResolvedValue({ email: 'x@example.com' });
		const corrupt = await createOAuth().handleOAuthReturn();
		expect(corrupt).toEqual({ restoredSelectedType: undefined, restoredDisplayName: undefined });

		const missing = await createOAuth().handleOAuthReturn();
		expect(missing).toEqual({ restoredSelectedType: undefined, restoredDisplayName: undefined });
	});

	test('a failed pending-email lookup shows an error but still cleans the URL', async () => {
		setPageUrl('https://app.example/settings/providers/p1/edit?provider_connected=true&nonce=n-3');
		get.mockRejectedValue(new ApiError('Internal server error', 500));
		const oauth = createOAuth();
		await oauth.handleOAuthReturn();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't find the Google account you connected. ${SERVER_FAILURE_MESSAGE}`
		);
		expect(oauth.pendingEmail).toBe('');
		expect(goto).toHaveBeenCalledWith('/settings/providers/p1/edit', { replace: true });
	});

	test('an expired pending-email lookup asks to connect again, not the server text', async () => {
		setPageUrl('https://app.example/settings/providers/p1/edit?provider_connected=true&nonce=n-4');
		get.mockRejectedValue(new ApiError('Pending provider credentials not found', 404));
		await createOAuth().handleOAuthReturn();
		expect(showError).toHaveBeenCalledWith(
			"Couldn't find the Google account you connected. Connect it again."
		);
	});

	test('provider_connected without a nonce is ignored', async () => {
		setPageUrl('https://app.example/settings/providers/new?provider_connected=true');
		await expect(createOAuth().handleOAuthReturn()).resolves.toEqual({});
		expect(get).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	test.each([
		['cancelled', 'Google account connection was cancelled.'],
		['exchange_failed', "Couldn't connect your Google account. Try again."],
		['no_refresh_token', 'Google did not grant offline access. Please try again.'],
		['session_expired', 'Your session expired. Please log in and try again.'],
		['invalid_state', 'The Google connection expired. Please try again.'],
		[
			'session_mismatch',
			'You were signed in as someone else when Google finished connecting. Sign in again and retry.'
		],
		['something_else', "Couldn't connect your Google account. Try again."]
	])('provider_error=%s shows a specific message and cleans the URL', async (code, message) => {
		setPageUrl(`https://app.example/settings/providers/new?provider_error=${code}`);
		await expect(createOAuth().handleOAuthReturn()).resolves.toEqual({});
		expect(showError).toHaveBeenCalledWith(message);
		expect(goto).toHaveBeenCalledWith('/settings/providers/new', { replace: true });
	});
});
