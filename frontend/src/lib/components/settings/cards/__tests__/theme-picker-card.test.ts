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
const { THEME_REGISTRY } = await import('#lib/theme/theme-registry.ts');
const ThemePickerCard = (await import('../ThemePickerCard.svelte')).default;

function themeButton(label: string): HTMLButtonElement {
	return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

function swatchCount(button: HTMLElement): number {
	return button.querySelectorAll('[aria-hidden="true"] > span').length;
}

beforeEach(() => {
	updateSettings.mockResolvedValue({} as UserSettings);
	themeStore.setPreference('light');
	themeStore.setTheme('default');
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('ThemePickerCard', () => {
	test('shows every accent as a tile, in a section named Accent', () => {
		render(ThemePickerCard);
		expect(screen.getByLabelText('Accent')).toBeInTheDocument();
		for (const theme of Object.values(THEME_REGISTRY)) {
			expect(themeButton(theme.label)).toBeInTheDocument();
		}
		expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
	});

	test('marks only the active accent as pressed, including a stored old theme id', () => {
		themeStore.setTheme('vaporwave');
		render(ThemePickerCard);
		const pressed = screen
			.getAllByRole('button')
			.filter(b => b.getAttribute('aria-pressed') === 'true');
		expect(pressed).toHaveLength(1);
		expect(pressed[0]).toHaveAccessibleName('Electric');
	});

	test('choosing an accent selects it, persists it locally and syncs it to the server', async () => {
		render(ThemePickerCard);
		await fireEvent.click(themeButton('Vermilion'));

		expect(themeButton('Vermilion')).toHaveAttribute('aria-pressed', 'true');
		expect(themeButton('Amber')).toHaveAttribute('aria-pressed', 'false');
		expect(themeStore.themeId).toBe('vermilion');
		expect(localStorage.getItem('vroom-theme-id')).toBe('vermilion');
		expect(updateSettings).toHaveBeenCalledWith({ themePreference: 'vermilion' });
	});

	test.each(['light', 'dark', 'system'] as const)(
		'in %s mode every accent shows one swatch per swatch token',
		preference => {
			themeStore.setPreference(preference);
			render(ThemePickerCard);
			for (const theme of Object.values(THEME_REGISTRY)) {
				expect(swatchCount(themeButton(theme.label))).toBe(theme.swatch.length);
			}
		}
	);
});
