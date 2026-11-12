import { beforeEach, describe, expect, test, vi } from 'vitest';
import { gotoDynamic } from '../navigation';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({
	resolve: (id: string) => {
		if (/^https?:/.test(id)) throw new Error('absolute URLs are not resolvable');
		return id;
	}
}));

describe('gotoDynamic', () => {
	beforeEach(() => {
		goto.mockReset();
		goto.mockResolvedValue(undefined);
	});

	test('navigates to a runtime path that resolves to an app route', async () => {
		await gotoDynamic('/vehicles/abc');

		expect(goto).toHaveBeenCalledWith('/vehicles/abc');
	});

	test('falls back to the dashboard when goto rejects the destination', async () => {
		goto.mockRejectedValueOnce(new Error('not an app route'));

		await gotoDynamic('/not-a-route');

		expect(goto).toHaveBeenLastCalledWith('/dashboard');
	});

	test('falls back to the dashboard for an absolute URL that cannot be resolved', async () => {
		await gotoDynamic('https://example.com/phish');

		expect(goto).toHaveBeenCalledTimes(1);
		expect(goto).toHaveBeenCalledWith('/dashboard');
	});
});
