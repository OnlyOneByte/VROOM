import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleShare } from '$lib/types';

// Mock apiClient (the reminder-api.test.ts pattern) — apiClient.get/post/put already unwrap the
// { success, data } envelope, so these wrappers should pass through verbatim with the right URL/body.
vi.mock('../api-client', () => ({
	apiClient: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
		delete: vi.fn()
	}
}));

const { apiClient } = await import('../api-client');
const { shareApi } = await import('../share-api');

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);

const share: VehicleShare = {
	id: 's1',
	vehicleId: 'v1',
	ownerId: 'owner',
	sharedWithId: 'invitee',
	level: 'viewer',
	status: 'pending',
	createdAt: '2026-06-27T00:00:00.000Z',
	updatedAt: '2026-06-27T00:00:00.000Z'
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('shareApi — owner side (T3)', () => {
	it('invite POSTs the {vehicleId,email,level} body to /shares', async () => {
		mockPost.mockResolvedValue(share);
		const res = await shareApi.invite({ vehicleId: 'v1', email: 'b@test.com', level: 'viewer' });
		expect(mockPost).toHaveBeenCalledWith('/api/v1/shares', {
			vehicleId: 'v1',
			email: 'b@test.com',
			level: 'viewer'
		});
		expect(res).toEqual(share);
	});

	it('listGranted GETs /shares/granted', async () => {
		mockGet.mockResolvedValue([share]);
		const res = await shareApi.listGranted();
		expect(mockGet).toHaveBeenCalledWith('/api/v1/shares/granted');
		expect(res).toEqual([share]);
	});

	it('changeLevel PUTs the level to /shares/:id', async () => {
		mockPut.mockResolvedValue({ ...share, level: 'editor' });
		const res = await shareApi.changeLevel('s1', 'editor');
		expect(mockPut).toHaveBeenCalledWith('/api/v1/shares/s1', { level: 'editor' });
		expect(res.level).toBe('editor');
	});

	it('revoke DELETEs /shares/:id', async () => {
		mockDelete.mockResolvedValue(undefined);
		await shareApi.revoke('s1');
		expect(mockDelete).toHaveBeenCalledWith('/api/v1/shares/s1');
	});
});

describe('shareApi — invitee side (T4)', () => {
	it('listReceived GETs /shares/received', async () => {
		mockGet.mockResolvedValue([share]);
		const res = await shareApi.listReceived();
		expect(mockGet).toHaveBeenCalledWith('/api/v1/shares/received');
		expect(res).toEqual([share]);
	});

	it('accept POSTs (no body) to /shares/:id/accept', async () => {
		mockPost.mockResolvedValue({ ...share, status: 'accepted' });
		const res = await shareApi.accept('s1');
		expect(mockPost).toHaveBeenCalledWith('/api/v1/shares/s1/accept');
		expect(res.status).toBe('accepted');
	});

	it('decline POSTs (no body) to /shares/:id/decline', async () => {
		mockPost.mockResolvedValue(undefined);
		await shareApi.decline('s1');
		expect(mockPost).toHaveBeenCalledWith('/api/v1/shares/s1/decline');
	});
});
