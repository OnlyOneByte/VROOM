import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedAuthProvider, User } from '#lib/types/index.ts';

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({ goto }));

const { authApi } = await import('../auth-api');
const { ApiError, NetworkError } = await import('#lib/utils/error-handling.ts');

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

function emptyResponse(status = 204): Response {
	return {
		ok: true,
		status,
		headers: new Headers(),
		json: () => Promise.reject(new Error('no body'))
	} as unknown as Response;
}

function lastCall(): { url: string; init: globalThis.RequestInit } {
	const [url, init] = mockFetch.mock.calls.at(-1) as [string, globalThis.RequestInit];
	return { url, init };
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
	try {
		await p;
	} catch (e) {
		return e;
	}
	throw new Error('expected the promise to reject, but it resolved');
}

const user: User = {
	id: 'u1',
	email: 'driver@example.com',
	displayName: 'New Name',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-11-01T00:00:00.000Z'
};

const linked: LinkedAuthProvider = {
	id: 'acc-1',
	providerType: 'google',
	displayName: 'Google',
	email: 'driver@example.com',
	createdAt: '2026-01-01T00:00:00.000Z'
};

beforeEach(() => {
	mockFetch.mockReset();
	goto.mockClear();
});

describe('authApi.getProviders', () => {
	it('GETs /auth/providers with credentials and no body, unwrapping the data envelope', async () => {
		const providers = [{ id: 'google', displayName: 'Google' }];
		mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: providers }));

		const result = await authApi.getProviders();

		const { url, init } = lastCall();
		expect(url).toBe('/api/v1/auth/providers');
		expect(init.method).toBe('GET');
		expect(init.credentials).toBe('include');
		expect(init.body).toBeUndefined();
		expect(result).toEqual(providers);
	});

	it('surfaces a server error as an ApiError carrying the server message and status', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: { message: 'Providers unavailable', code: 'UNAVAILABLE' } }, 503)
		);

		const error = await rejectionOf(authApi.getProviders());

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			message: 'Providers unavailable',
			statusCode: 503,
			code: 'UNAVAILABLE'
		});
	});

	it('wraps a transport failure in a NetworkError', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const error = await rejectionOf(authApi.getProviders());

		expect(error).toBeInstanceOf(NetworkError);
	});
});

describe('authApi.updateProfile', () => {
	it('PATCHes /auth/me with a JSON body holding only the displayName', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { user } }));

		const result = await authApi.updateProfile({ displayName: 'New Name' });

		const { url, init } = lastCall();
		expect(url).toBe('/api/v1/auth/me');
		expect(init.method).toBe('PATCH');
		expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
		expect(JSON.parse(init.body as string)).toEqual({ displayName: 'New Name' });
		expect(result).toEqual({ user });
	});

	it('rejects a validation failure with the server message and field details', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{
					error: {
						message: 'Display name is too long',
						code: 'VALIDATION_ERROR',
						details: [{ path: ['displayName'], message: 'Too long' }]
					}
				},
				400
			)
		);

		const error = await rejectionOf(authApi.updateProfile({ displayName: 'x'.repeat(500) }));

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			message: 'Display name is too long',
			statusCode: 400,
			details: { validationErrors: [{ path: ['displayName'], message: 'Too long' }] }
		});
	});

	it('a 401 from /auth/me is reported to the caller without redirecting to sign-in', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'Unauthorized' }, 401));

		const error = await rejectionOf(authApi.updateProfile({ displayName: 'New Name' }));

		expect(error).toMatchObject({ message: 'Unauthorized', statusCode: 401 });
		await new Promise(r => setTimeout(r, 0));
		expect(goto).not.toHaveBeenCalled();
	});
});

describe('authApi.getLinkedAccounts', () => {
	it('GETs /auth/accounts and returns the linked providers', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: [linked] }));

		const result = await authApi.getLinkedAccounts();

		const { url, init } = lastCall();
		expect(url).toBe('/api/v1/auth/accounts');
		expect(init.method).toBe('GET');
		expect(result).toEqual([linked]);
	});

	it('falls back to a status-based message when the error body is not JSON', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			headers: new Headers({ 'content-type': 'text/html' }),
			json: () => Promise.reject(new SyntaxError('Unexpected token <'))
		} as unknown as Response);

		const error = await rejectionOf(authApi.getLinkedAccounts());

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			message: 'Request failed with status 500',
			statusCode: 500
		});
	});
});

describe('authApi.unlinkAccount', () => {
	it('DELETEs /auth/accounts/:id with no body', async () => {
		mockFetch.mockResolvedValueOnce(emptyResponse());

		await authApi.unlinkAccount('acc-1');

		const { url, init } = lastCall();
		expect(url).toBe('/api/v1/auth/accounts/acc-1');
		expect(init.method).toBe('DELETE');
		expect(init.body).toBeUndefined();
	});

	it('rejects with the server message when the last sign-in method cannot be unlinked', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{ error: { message: 'Cannot unlink your only sign-in method', code: 'CONFLICT' } },
				409
			)
		);

		const error = await rejectionOf(authApi.unlinkAccount('acc-1'));

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			message: 'Cannot unlink your only sign-in method',
			statusCode: 409,
			code: 'CONFLICT'
		});
	});
});
