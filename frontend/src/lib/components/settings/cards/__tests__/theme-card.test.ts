import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UserSettings } from '#lib/types/index.ts';

const { updateSettings } = vi.hoisted(() => ({
	updateSettings: vi.fn<(updates: Partial<UserSettings>) => Promise<UserSettings>>()
}));

vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: { updateSettings: (updates: Partial<UserSettings>) => updateSettings(updates) }
}));

const { themeStore } = await import('#lib/stores/theme.svelte.ts');
const ThemeCard = (await import('../ThemeCard.svelte')).default;

beforeEach(() => {
	updateSettings.mockResolvedValue({} as UserSettings);
	themeStore.setPreference('light');
	themeStore.setTheme('default');
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('ThemeCard', () => {
	test('offers Light, Dark and System', () => {
		render(ThemeCard);
		expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
	});

	test.each(['dark', 'system', 'light'] as const)(
		'choosing %s stores the preference',
		async preference => {
			render(ThemeCard);
			const label = preference.charAt(0).toUpperCase() + preference.slice(1);
			await fireEvent.click(screen.getByRole('button', { name: label }));

			expect(themeStore.current).toBe(preference);
			expect(localStorage.getItem('vroom-theme-preference')).toBe(preference);
		}
	);

	test('choosing Dark switches the document to dark mode', async () => {
		render(ThemeCard);
		await fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		await fireEvent.click(screen.getByRole('button', { name: 'Light' }));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});
