import { afterEach, describe, expect, it, vi } from 'vitest';

function registeredHandler(event: string): () => void {
	const call = vi.mocked(window.addEventListener).mock.calls.find(([name]) => name === event);
	if (!call) throw new Error(`no ${event} listener registered`);
	return call[1] as () => void;
}

describe('onlineStatus', () => {
	afterEach(() => {
		vi.resetModules();
	});

	it('goes offline on the window offline event and back online on the online event', async () => {
		vi.mocked(window.addEventListener).mockClear();
		const { onlineStatus } = await import('../offline.svelte');

		registeredHandler('offline')();
		expect(onlineStatus.current).toBe(false);

		registeredHandler('online')();
		expect(onlineStatus.current).toBe(true);
	});
});
