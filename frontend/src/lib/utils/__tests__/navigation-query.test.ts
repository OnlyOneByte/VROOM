import { beforeEach, describe, expect, test, vi } from 'vitest';
import { gotoWithQuery } from '../navigation';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({ resolve: (id: string) => id }));

describe('gotoWithQuery', () => {
	beforeEach(() => {
		goto.mockReset();
		goto.mockResolvedValue(undefined);
	});

	test('appends the encoded query to the resolved path', async () => {
		await gotoWithQuery('/expenses', { vehicleId: 'v 1', category: 'fuel&more' });

		expect(goto).toHaveBeenCalledWith('/expenses?vehicleId=v+1&category=fuel%26more');
	});

	test('navigates to the bare path when the query is empty', async () => {
		await gotoWithQuery('/expenses', {});

		expect(goto).toHaveBeenCalledWith('/expenses');
	});
});
