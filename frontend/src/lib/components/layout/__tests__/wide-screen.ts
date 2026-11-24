import { afterEach, beforeEach, vi } from 'vitest';

export function onWideScreen(): void {
	let narrow: ((query: string) => MediaQueryList) | undefined;
	beforeEach(() => {
		narrow = vi.mocked(window.matchMedia).getMockImplementation();
		vi.mocked(window.matchMedia).mockImplementation(
			query =>
				({
					matches: query === '(min-width: 64rem)',
					addEventListener: vi.fn(),
					removeEventListener: vi.fn()
				}) as unknown as MediaQueryList
		);
	});
	afterEach(() => {
		if (narrow) vi.mocked(window.matchMedia).mockImplementation(narrow);
	});
}
