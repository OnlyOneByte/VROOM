import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { packRules } from '@casl/ability/extra';
import type { PackedRules } from '#lib/utils/permissions.ts';
import type { PendingAccount, ServerInvite, SignupSettings } from '#lib/services/signup-api.ts';

const api = vi.hoisted(() => ({
	serverRules: vi.fn<() => Promise<PackedRules>>(),
	getSettings: vi.fn<() => Promise<SignupSettings>>(),
	updateSettings: vi.fn<(c: Partial<SignupSettings>) => Promise<SignupSettings>>(),
	listInvites: vi.fn<() => Promise<ServerInvite[]>>(),
	createInvite: vi.fn<(email: string, days: number) => Promise<ServerInvite>>(),
	revokeInvite: vi.fn<(id: string) => Promise<ServerInvite>>(),
	listPending: vi.fn<() => Promise<PendingAccount[]>>(),
	approve: vi.fn<(id: string) => Promise<void>>(),
	reject: vi.fn<(id: string) => Promise<void>>()
}));
vi.mock('#lib/services/signup-api.ts', () => ({ signupApi: api }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
const showSuccess = vi.fn();
const showError = vi.fn();
vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { showSuccess, showError } }));

const ServerPage = (await import('../+page.svelte')).default;

const ADMIN = packRules([{ action: 'server.signup.manage', subject: 'all' }]) as PackedRules;
const SETTINGS: SignupSettings = {
	mode: 'invite',
	modeLocked: false,
	allowedDomains: [],
	domainsLocked: false
};
const INVITE: ServerInvite = {
	id: 'i1',
	email: 'sam@example.com',
	status: 'active',
	createdAt: '2026-11-20T12:00:00.000Z',
	expiresAt: '2026-11-27T12:00:00.000Z',
	usedAt: null,
	revokedAt: null
};

beforeEach(() => {
	vi.clearAllMocks();
	api.serverRules.mockResolvedValue(ADMIN);
	api.getSettings.mockResolvedValue(SETTINGS);
	api.updateSettings.mockImplementation(async c => ({ ...SETTINGS, ...c }));
	api.listInvites.mockResolvedValue([]);
	api.listPending.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Server settings page', () => {
	test('someone who does not manage sign-up is told so and nothing else loads', async () => {
		api.serverRules.mockResolvedValue([]);
		render(ServerPage);
		expect(await screen.findByTestId('not-admin')).toBeInTheDocument();
		expect(api.getSettings).not.toHaveBeenCalled();
	});

	test('choosing a mode saves nothing until Save Mode', async () => {
		render(ServerPage);
		const save = await screen.findByRole('button', { name: 'Save Mode' });
		expect(save).toBeDisabled();
		await fireEvent.click(screen.getByTestId('signup-mode-approval'));
		expect(api.updateSettings).not.toHaveBeenCalled();
		await fireEvent.click(save);
		await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ mode: 'approval' }));
		expect(showSuccess).toHaveBeenCalledWith('Sign-up mode saved');
	});

	test('a list that fails to load offers Retry', async () => {
		api.listInvites.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([INVITE]);
		render(ServerPage);
		const card = (await screen.findByText("Couldn't load invites")).closest('[role="alert"]');
		expect(card).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(await screen.findByTestId('invite-list')).toBeInTheDocument();
	});

	test('an out-of-range expiry is refused on the days field', async () => {
		render(ServerPage);
		await fireEvent.input(await screen.findByLabelText(/^Email/), {
			target: { value: 'sam@example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Expires in (days)'), { target: { value: '91' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('from 1 to 90');
		expect(screen.getByLabelText('Expires in (days)')).toHaveFocus();
		expect(api.createInvite).not.toHaveBeenCalled();
	});

	test('a mode set by SIGNUP_MODE is locked', async () => {
		api.getSettings.mockResolvedValue({ ...SETTINGS, mode: 'closed', modeLocked: true });
		render(ServerPage);
		expect(await screen.findByTestId('signup-mode-locked')).toHaveTextContent('SIGNUP_MODE');
		expect(screen.getByTestId('signup-mode-open')).toBeDisabled();
		expect(screen.getByTestId('invites-closed')).toBeInTheDocument();
	});

	test('an empty invite is refused in place, and a valid one joins the list', async () => {
		api.createInvite.mockResolvedValue(INVITE);
		render(ServerPage);
		const invite = await screen.findByRole('button', { name: 'Invite' });
		await fireEvent.click(invite);
		expect(await screen.findByRole('alert')).toHaveTextContent('Enter the email to invite.');
		expect(screen.getByLabelText(/^Email/)).toHaveFocus();

		await fireEvent.input(screen.getByLabelText(/^Email/), {
			target: { value: 'sam@example.com' }
		});
		await fireEvent.click(invite);
		const list = await screen.findByTestId('invite-list');
		expect(within(list).getByText('sam@example.com')).toBeInTheDocument();
		expect(api.createInvite).toHaveBeenCalledWith('sam@example.com', 7);
	});

	test('revoking an open invite asks first', async () => {
		api.listInvites.mockResolvedValue([INVITE]);
		api.revokeInvite.mockResolvedValue({
			...INVITE,
			status: 'revoked',
			revokedAt: INVITE.expiresAt
		});
		render(ServerPage);
		await fireEvent.click(
			await screen.findByRole('button', { name: 'Revoke the invite for sam@example.com' })
		);
		await fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(api.revokeInvite).toHaveBeenCalledWith('i1'));
		expect(await screen.findByText('Revoked')).toBeInTheDocument();
	});

	test('approving a waiting account takes it off the list', async () => {
		api.listPending.mockResolvedValue([
			{ id: 'p1', email: 'kim@example.com', displayName: 'Kim', pendingSince: null }
		]);
		api.approve.mockResolvedValue();
		render(ServerPage);
		await fireEvent.click(await screen.findByRole('button', { name: 'Approve kim@example.com' }));
		expect(await screen.findByTestId('pending-empty')).toBeInTheDocument();
		expect(api.approve).toHaveBeenCalledWith('p1');
	});
});
