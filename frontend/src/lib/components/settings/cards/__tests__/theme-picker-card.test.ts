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
	return screen.getByRole('button', { name: new RegExp(`^${label}\\b`) }) as HTMLButtonElement;
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
	test('lists every registered theme with its label and description', () => {
		render(ThemePickerCard);
		for (const theme of Object.values(THEME_REGISTRY)) {
			expect(screen.getByText(theme.label)).toBeInTheDocument();
			expect(screen.getByText(theme.description)).toBeInTheDocument();
		}
	});

	test('marks only the active theme as pressed', () => {
		render(ThemePickerCard);
		const pressed = screen
			.getAllByRole('button')
			.filter(b => b.getAttribute('aria-pressed') === 'true');
		expect(pressed).toHaveLength(1);
		expect(pressed[0]).toHaveTextContent('Default');
	});

	test('choosing a theme selects it, persists it locally and syncs it to the server', async () => {
		render(ThemePickerCard);
		await fireEvent.click(themeButton('Blueprint'));

		expect(themeButton('Blueprint')).toHaveAttribute('aria-pressed', 'true');
		expect(themeButton('Default')).toHaveAttribute('aria-pressed', 'false');
		expect(themeStore.themeId).toBe('blueprint');
		expect(localStorage.getItem('vroom-theme-id')).toBe('blueprint');
		expect(updateSettings).toHaveBeenCalledWith({ themePreference: 'blueprint' });
	});

	test.each(['light', 'dark', 'system'] as const)(
		'in %s mode every theme shows one swatch per swatch token',
		preference => {
			themeStore.setPreference(preference);
			render(ThemePickerCard);
			for (const theme of Object.values(THEME_REGISTRY)) {
				expect(swatchCount(themeButton(theme.label))).toBe(theme.swatch.length);
			}
		}
	);
});
