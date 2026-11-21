import { describe, expect, test } from 'vitest';
import { latest } from '../latest-request.ts';

describe('latest()', () => {
	test('only the most recently started request is current', () => {
		const nextRequest = latest();
		const first = nextRequest();
		expect(first()).toBe(true);

		const second = nextRequest();
		expect(first()).toBe(false);
		expect(second()).toBe(true);
	});

	test('separate trackers do not invalidate each other', () => {
		const pages = latest();
		const summaries = latest();
		const page = pages();
		summaries();
		expect(page()).toBe(true);
	});

	test('an older response that resolves last is reported stale', async () => {
		const nextRequest = latest();
		const applied: string[] = [];
		let resolveOld: (v: string) => void = () => {};
		const run = async (response: Promise<string>) => {
			const isCurrent = nextRequest();
			const value = await response;
			if (isCurrent()) applied.push(value);
		};

		const old = run(new Promise<string>(resolve => (resolveOld = resolve)));
		const fresh = run(Promise.resolve('new'));
		await fresh;
		resolveOld('old');
		await old;

		expect(applied).toEqual(['new']);
	});
});
