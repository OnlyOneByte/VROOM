/**
 * Coverage ratchet (guard, C143) for api-client.ts — the C124 low spot + the most load-bearing FE
 * module: EVERY API call routes through `request`/`requestFull` here (envelope unwrap, error parsing,
 * header gating, pagination). The sibling service tests all MOCK this module, so its real internals
 * were never exercised. Here we stub global.fetch (the auth.test.ts pattern) and drive the REAL
 * apiClient methods, asserting the behavior every caller depends on.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// api-client reads PUBLIC_API_URL from $env/dynamic/public; pin it empty so getApiBaseUrl() === ''
// (same-origin) and the asserted URLs are the bare paths.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const { apiClient, getApiBaseUrl, withPagination } = await import('../api-client');
const { ApiError } = await import('$lib/utils/error-handling');

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** A JSON Response double (api-client checks .ok, content-type, then .json()). */
function jsonResponse(body: unknown, { ok = true, status = 200 } = {}): Response {
	return {
		ok,
		status,
		headers: new Headers({ 'content-type': 'application/json' }),
		json: () => Promise.resolve(body)
	} as unknown as Response;
}

/** Await a promise expected to reject, returning the thrown ApiError (typed, for assertions). */
async function captureError(p: Promise<unknown>): Promise<InstanceType<typeof ApiError>> {
	try {
		await p;
		throw new Error('expected the promise to reject, but it resolved');
	} catch (e) {
		return e as InstanceType<typeof ApiError>;
	}
}

beforeEach(() => {
	mockFetch.mockReset();
});
afterEach(() => {
	vi.clearAllMocks();
});

describe('getApiBaseUrl', () => {
	test('returns empty string when PUBLIC_API_URL is unset (same-origin)', () => {
		expect(getApiBaseUrl()).toBe('');
	});
});

describe('request envelope unwrapping', () => {
	test('GET unwraps the { success, data } envelope to data', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'v1' } }));
		const result = await apiClient.get<{ id: string }>('/api/v1/vehicles/v1');
		expect(result).toEqual({ id: 'v1' });
	});

	test('a response WITHOUT a data field is returned as-is (no over-unwrap)', async () => {
		// result.data === undefined → return result verbatim (e.g. a bare object).
		mockFetch.mockResolvedValueOnce(jsonResponse({ count: 3, monthlyTotal: 10 }));
		const result = await apiClient.get('/api/v1/reminders/recurring-cost');
		expect(result).toEqual({ count: 3, monthlyTotal: 10 });
	});

	test('a falsy-but-present data value (data: 0) still unwraps (uses !== undefined, not truthiness)', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, data: 0 }));
		const result = await apiClient.get<number>('/api/v1/some-count');
		expect(result).toBe(0);
	});

	test('a non-JSON response (204, no content-type) is returned without parsing', async () => {
		const raw = { ok: true, status: 204, headers: new Headers(), json: () => Promise.reject(new Error('no body')) };
		mockFetch.mockResolvedValueOnce(raw as unknown as Response);
		const result = await apiClient.delete('/api/v1/expenses/e1');
		// The Response object itself is returned (cast) — not a thrown parse error.
		expect(result).toBe(raw);
	});
});

describe('request method + header behavior', () => {
	test('GET sends method GET, credentials include, and no Content-Type (no body)', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
		await apiClient.get('/api/v1/vehicles');
		const [url, init] = mockFetch.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/vehicles');
		expect(init?.method).toBe('GET');
		expect(init?.credentials).toBe('include');
		expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
	});

	test('POST with a body sets Content-Type application/json and JSON-stringifies it', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ data: { id: 'e1' } }));
		await apiClient.post('/api/v1/expenses', { amount: 42 });
		const [, init] = mockFetch.mock.calls[0] ?? [];
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(init?.body).toBe(JSON.stringify({ amount: 42 }));
	});

	test('a FormData body is passed through untouched (no Content-Type, no stringify)', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({ data: { id: 'p1' } }));
		const fd = new FormData();
		fd.append('photo', 'x');
		await apiClient.post('/api/v1/photos', fd, {});
		const [, init] = mockFetch.mock.calls[0] ?? [];
		// Browser sets the multipart Content-Type+boundary itself; we must NOT set it.
		expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
		expect(init?.body).toBe(fd);
	});
});

describe('request error handling', () => {
	test('a non-ok response throws ApiError carrying the backend error.message + code + status', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{ error: { message: 'Vehicle not found', code: 'NOT_FOUND' } },
				{ ok: false, status: 404 }
			)
		);
		const err = await captureError(apiClient.get('/api/v1/vehicles/x'));
		expect(err).toBeInstanceOf(ApiError);
		expect(err.message).toBe('Vehicle not found');
		expect(err.statusCode).toBe(404);
		expect(err.code).toBe('NOT_FOUND');
	});

	test('falls back to errorBody.message when there is no nested error object', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ message: 'top-level message' }, { ok: false, status: 400 })
		);
		const err = await captureError(apiClient.get('/api/v1/x'));
		expect(err.message).toBe('top-level message');
	});

	test('array error.details are wrapped as { validationErrors }', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse(
				{ error: { message: 'Invalid', code: 'VALIDATION_ERROR', details: ['amount required'] } },
				{ ok: false, status: 400 }
			)
		);
		const err = await captureError(apiClient.post('/api/v1/expenses', {}));
		expect(err.details).toEqual({ validationErrors: ['amount required'] });
	});

	test('falls back to a status message when the error body is not JSON', async () => {
		const bad = {
			ok: false,
			status: 500,
			headers: new Headers({ 'content-type': 'text/html' }),
			json: () => Promise.reject(new Error('not json'))
		};
		mockFetch.mockResolvedValueOnce(bad as unknown as Response);
		const err = await captureError(apiClient.get('/api/v1/x'));
		expect(err.message).toBe('Request failed with status 500');
		expect(err.statusCode).toBe(500);
	});
});

describe('getPaginated (requestFull — does NOT unwrap data)', () => {
	test('returns the full { data, pagination } envelope, not just data', async () => {
		const envelope = {
			data: [{ id: 'e1' }],
			pagination: { totalCount: 1, limit: 20, offset: 0, hasMore: false }
		};
		mockFetch.mockResolvedValueOnce(jsonResponse(envelope));
		const result = await apiClient.getPaginated('/api/v1/expenses');
		expect(result).toEqual(envelope);
		expect(result.pagination.totalCount).toBe(1);
	});

	test('getPaginated throws ApiError on a non-ok response', async () => {
		mockFetch.mockResolvedValueOnce(
			jsonResponse({ error: { message: 'Boom', code: 'X' } }, { ok: false, status: 500 })
		);
		await expect(apiClient.getPaginated('/api/v1/expenses')).rejects.toThrow(ApiError);
	});
});

describe('withPagination', () => {
	test('appends limit + offset as query params', () => {
		expect(withPagination('/api/v1/expenses', { limit: 20, offset: 40 })).toBe(
			'/api/v1/expenses?limit=20&offset=40'
		);
	});

	test('includes offset=0 (it is defined) but omits undefined params', () => {
		expect(withPagination('/api/v1/expenses', { offset: 0 })).toBe('/api/v1/expenses?offset=0');
	});

	test('returns the bare url when no params are given', () => {
		expect(withPagination('/api/v1/expenses')).toBe('/api/v1/expenses');
	});
});

// apiClient.raw (api-client.ts:131-132) was UNCOVERED — it's the raw-Response fetch used for file
// downloads (e.g. the backup-ZIP export, NORTH_STAR #1 data portability). Unlike request(), it does NOT
// unwrap the envelope; it returns the Response directly. The load-bearing bits: a relative url is
// base-prefixed (absolute http(s) passes through), and `credentials: 'include'` is ALWAYS sent so the
// auth cookie rides along (a dropped credentials = a 401 on every download).
describe('apiClient.raw', () => {
	test('prefixes a relative url with the base and always sends credentials: include', async () => {
		const resp = jsonResponse({ ok: true });
		mockFetch.mockResolvedValueOnce(resp);

		const out = await apiClient.raw('/api/v1/backup/export');

		// returns the Response verbatim (no envelope unwrap)
		expect(out).toBe(resp);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] ?? [];
		expect(url).toBe('/api/v1/backup/export'); // base is '' (PUBLIC_API_URL unset) → bare path
		expect(init?.credentials).toBe('include');
	});

	test('passes an absolute http url through unchanged (no base prefix)', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}));
		await apiClient.raw('https://cdn.example.com/file.zip');
		const [url] = mockFetch.mock.calls[0] ?? [];
		expect(url).toBe('https://cdn.example.com/file.zip');
	});

	test('forwards the method + headers options', async () => {
		mockFetch.mockResolvedValueOnce(jsonResponse({}));
		await apiClient.raw('/api/v1/backup/export', {
			method: 'POST',
			headers: { 'X-Test': '1' }
		});
		const [, init] = mockFetch.mock.calls[0] ?? [];
		expect(init?.method).toBe('POST');
		expect(init?.headers).toEqual({ 'X-Test': '1' });
		expect(init?.credentials).toBe('include'); // credentials still forced even with options
	});
});
