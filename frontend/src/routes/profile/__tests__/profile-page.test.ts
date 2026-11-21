import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { LinkedAuthProvider, User } from '#lib/types/index.ts';

const { page, showError, showSuccess, authApi } = vi.hoisted(() => ({
	page: { url: new URL('https://app.example/profile') },
	showError: vi.fn<(message: string) => void>(),
	showSuccess: vi.fn<(message: string) => void>(),
	authApi: {
		getLinkedAccounts: vi.fn<() => Promise<LinkedAuthProvider[]>>(),
		getProviders: vi.fn<() => Promise<{ id: string; displayName: string }[]>>(),
		unlinkAccount: vi.fn<(id: string) => Promise<void>>(),
		updateProfile: vi.fn<(data: { displayName: string }) => Promise<{ user: User }>>()
	}
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('#lib/services/auth-api.ts', () => ({ authApi }));
vi.mock('#lib/services/api-client.ts', () => ({
	apiClient: { get: vi.fn() },
	getApiBaseUrl: () => 'https://api.example'
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		showError: (message: string) => showError(message),
		showSuccess: (message: string) => showSuccess(message)
	}
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: { settings: null, downloadBackup: vi.fn() }
}));

const { authStore } = await import('#lib/stores/auth.svelte.ts');
const ProfilePage = (await import('../+page.svelte')).default;

const USER: User = {
	id: 'u1',
	email: 'ada@example.com',
	displayName: 'Ada Lovelace',
	createdAt: '2024-03-15T12:00:00.000Z',
	updatedAt: '2024-03-15T12:00:00.000Z'
};

function account(overrides: Partial<LinkedAuthProvider> = {}): LinkedAuthProvider {
	return {
		id: 'a1',
		providerType: 'google',
		displayName: 'Google',
		email: 'ada@gmail.com',
		createdAt: '2024-03-15T12:00:00.000Z',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount() {
	const result = render(ProfilePage);
	await settle();
	return result;
}

const originalLocation = window.location;
let assignedHref = '';

beforeEach(() => {
	vi.clearAllMocks();
	page.url = new URL('https://app.example/profile');
	authStore.setUser({ ...USER });
	authApi.getLinkedAccounts.mockResolvedValue([account()]);
	authApi.getProviders.mockResolvedValue([
		{ id: 'google', displayName: 'Google' },
		{ id: 'github', displayName: 'GitHub' }
	]);
	authApi.unlinkAccount.mockResolvedValue();
	authApi.updateProfile.mockImplementation(async ({ displayName }) => ({
		user: { ...USER, displayName }
	}));
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
});

afterEach(() => {
	cleanup();
	authStore.clearUser();
	Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('Profile identity', () => {
	test('shows the user name, email, initials and member-since month', async () => {
		await mount();
		expect(screen.getByText('AL')).toBeInTheDocument();
		expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
		expect(screen.getAllByText('ada@example.com').length).toBeGreaterThan(0);
		expect(screen.getByText('March 2024')).toBeInTheDocument();
	});

	test('falls back to placeholders when no user is signed in', async () => {
		authStore.clearUser();
		await mount();
		expect(screen.getByText('?')).toBeInTheDocument();
		expect(screen.getByText('Unknown')).toBeInTheDocument();
		expect(screen.queryByText('March 2024')).toBeNull();
		expect(screen.queryByText('ada@example.com')).toBeNull();
	});
});

describe('Profile display-name editing', () => {
	async function startEditing() {
		await fireEvent.click(screen.getByRole('button', { name: 'Edit display name' }));
		return screen.getByRole('textbox', { name: 'Display name' }) as HTMLInputElement;
	}

	test('editing starts from the current name', async () => {
		await mount();
		const input = await startEditing();
		expect(input).toHaveValue('Ada Lovelace');
	});

	test('saving a trimmed new name updates the profile and leaves edit mode', async () => {
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: '  Ada King  ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
		await settle();
		expect(authApi.updateProfile).toHaveBeenCalledWith({ displayName: 'Ada King' });
		expect(showSuccess).toHaveBeenCalledWith('Display name updated');
		expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull();
		expect(screen.getAllByText('Ada King').length).toBeGreaterThan(0);
		expect(screen.getByText('AK')).toBeInTheDocument();
	});

	test('pressing Enter saves the name', async () => {
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: 'Countess' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		await settle();
		expect(authApi.updateProfile).toHaveBeenCalledWith({ displayName: 'Countess' });
	});

	test('pressing Escape cancels without saving', async () => {
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: 'Other' } });
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull();
		expect(authApi.updateProfile).not.toHaveBeenCalled();
	});

	test('the cancel button leaves edit mode without saving', async () => {
		await mount();
		await startEditing();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }));
		expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull();
		expect(authApi.updateProfile).not.toHaveBeenCalled();
	});

	test.each([
		['blank', '   '],
		['longer than 100 characters', 'x'.repeat(101)]
	])('rejects a %s name and stays in edit mode', async (_label, value) => {
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
		await settle();
		expect(showError).toHaveBeenCalledWith('Display name must be between 1 and 100 characters');
		expect(authApi.updateProfile).not.toHaveBeenCalled();
		expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
	});

	test('an unchanged name closes the editor without a request', async () => {
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: ' Ada Lovelace ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
		await settle();
		expect(authApi.updateProfile).not.toHaveBeenCalled();
		expect(screen.queryByRole('textbox', { name: 'Display name' })).toBeNull();
	});

	test('a failed save reports the error and keeps the editor open', async () => {
		authApi.updateProfile.mockRejectedValue(new Error('500'));
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: 'New Name' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
		await settle();
		expect(showError).toHaveBeenCalledWith('Failed to update display name');
		expect(screen.getByRole('textbox', { name: 'Display name' })).not.toBeDisabled();
	});

	test('the editor is disabled while the save is pending', async () => {
		authApi.updateProfile.mockReturnValue(new Promise(() => {}));
		await mount();
		const input = await startEditing();
		await fireEvent.input(input, { target: { value: 'New Name' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save display name' }));
		await settle();
		expect(input).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel editing' })).toBeDisabled();
	});
});

describe('Profile connected accounts', () => {
	test('lists linked accounts and offers only the providers not yet linked', async () => {
		await mount();
		expect(screen.getByText('ada@gmail.com')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Link GitHub/ })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Link Google/ })).toBeNull();
	});

	test('the only linked account cannot be unlinked', async () => {
		await mount();
		expect(screen.getByRole('button', { name: 'Unlink Google' })).toBeDisabled();
	});

	test('hides the link section when every provider is linked', async () => {
		authApi.getProviders.mockResolvedValue([{ id: 'google', displayName: 'Google' }]);
		await mount();
		expect(screen.queryByText('Link another account')).toBeNull();
	});

	test('an account with an unknown provider still renders', async () => {
		authApi.getLinkedAccounts.mockResolvedValue([
			account({ id: 'a9', providerType: 'okta', displayName: 'Okta', email: 'ada@okta.test' })
		]);
		authApi.getProviders.mockResolvedValue([{ id: 'okta2', displayName: 'Okta Two' }]);
		await mount();
		expect(screen.getByText('ada@okta.test')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Link Okta Two/ })).toBeInTheDocument();
	});

	test('unlinking removes the account from the list', async () => {
		authApi.getLinkedAccounts.mockResolvedValue([
			account(),
			account({ id: 'a2', providerType: 'github', displayName: 'GitHub', email: 'ada@gh.test' })
		]);
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink GitHub' }));
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' })
		);
		await settle();
		expect(authApi.unlinkAccount).toHaveBeenCalledWith('a2');
		expect(screen.queryByText('ada@gh.test')).toBeNull();
		expect(screen.getByRole('button', { name: /Link GitHub/ })).toBeInTheDocument();
	});

	test.each([
		[
			'LAST_ACCOUNT',
			Object.assign(new Error('x'), { code: 'LAST_ACCOUNT' }),
			'Cannot unlink your last sign-in method.'
		],
		['other', new Error('boom'), 'Failed to unlink account. Please try again.']
	])('an unlink failure with %s code shows its message', async (_label, failure, message) => {
		authApi.getLinkedAccounts.mockResolvedValue([
			account(),
			account({ id: 'a2', providerType: 'github', displayName: 'GitHub', email: 'ada@gh.test' })
		]);
		authApi.unlinkAccount.mockRejectedValue(failure);
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Unlink GitHub' }));
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' })
		);
		await settle();
		expect(screen.getByText(message)).toBeInTheDocument();
		expect(screen.getByText('ada@gh.test')).toBeInTheDocument();
	});

	test('linking a provider redirects to the API link endpoint', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: /Link GitHub/ }));
		expect(assignedHref).toBe('https://api.example/api/v1/auth/link/github');
		expect(screen.getByRole('button', { name: /Linking/ })).toBeDisabled();
	});

	test('a failed account load falls back to an empty list', async () => {
		authApi.getLinkedAccounts.mockRejectedValue(new Error('offline'));
		const { container } = await mount();
		await waitFor(() => expect(container.querySelector('[aria-label^="Unlink"]')).toBeNull());
		expect(screen.queryByText('Link another account')).toBeNull();
	});

	test('shows a spinner while accounts load', async () => {
		authApi.getLinkedAccounts.mockReturnValue(new Promise(() => {}));
		await mount();
		expect(screen.queryByText('Link another account')).toBeNull();
		expect(document.querySelector('.animate-spin')).not.toBeNull();
	});
});

describe('Profile link callback banners', () => {
	test.each([
		['account_conflict', 'This account is already linked to a different user.'],
		['already_linked', 'This account is already linked to your profile.'],
		['cancelled', 'Linking was cancelled.'],
		['invalid_state', 'The linking session expired. Please try again.'],
		[
			'session_mismatch',
			'You were signed in as someone else when linking finished. Sign in again and retry.'
		],
		['unknown_provider', 'This sign-in method is not supported.'],
		[
			'no_email',
			"We couldn't retrieve your email from this provider. Please check your provider's privacy settings."
		],
		['provider_unavailable', 'The sign-in provider is temporarily unavailable. Please try again.']
	])('link_error=%s shows its message', async (code, message) => {
		page.url = new URL(`https://app.example/profile?link_error=${code}`);
		await mount();
		expect(screen.getByText(message)).toBeInTheDocument();
	});

	test('an unknown link_error shows no banner', async () => {
		page.url = new URL('https://app.example/profile?link_error=weird&success=weird');
		await mount();
		expect(screen.queryByText(/already linked|cancelled|linked successfully/)).toBeNull();
	});

	test('success=linked confirms the link', async () => {
		page.url = new URL('https://app.example/profile?success=linked');
		await mount();
		expect(screen.getByText('Account linked successfully.')).toBeInTheDocument();
	});
});
