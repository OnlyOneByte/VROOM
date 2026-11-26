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
	test('offers Light, Dark and Auto as one labelled choice, with the current one checked', () => {
		render(ThemeCard);
		const group = screen.getByRole('radiogroup', { name: 'Light or dark' });
		expect(group).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'false');
		expect(screen.getByText(/Changes apply right away/)).toBeInTheDocument();
	});

	test.each([
		['Dark', 'dark'],
		['Auto', 'system'],
		['Light', 'light']
	] as const)('choosing %s stores the %s preference', async (label, preference) => {
		themeStore.setPreference(preference === 'light' ? 'dark' : 'light');
		render(ThemeCard);
		await fireEvent.click(screen.getByRole('radio', { name: label }));

		expect(themeStore.current).toBe(preference);
		expect(localStorage.getItem('vroom-theme-preference')).toBe(preference);
	});

	test('choosing Dark switches the document to dark mode', async () => {
		render(ThemeCard);
		await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
		expect(document.documentElement.classList.contains('dark')).toBe(true);

		await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});
});
