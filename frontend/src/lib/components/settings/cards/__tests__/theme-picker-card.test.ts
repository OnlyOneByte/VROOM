import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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

function themeGrid(): HTMLElement {
	const toggle = screen.getByRole('button', { name: /accents$/ });
	const grid = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
	if (!grid) throw new Error('accent grid missing');
	return grid;
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
	test('lists every accent with its label and description', () => {
		render(ThemePickerCard);
		const grid = within(themeGrid());
		for (const theme of Object.values(THEME_REGISTRY)) {
			expect(grid.getByText(theme.label)).toBeInTheDocument();
			expect(grid.getByText(theme.description)).toBeInTheDocument();
		}
	});

	test('below lg the grid starts collapsed behind the current accent and a Show all toggle', async () => {
		render(ThemePickerCard);
		const count = Object.keys(THEME_REGISTRY).length;
		const toggle = screen.getByRole('button', { name: `Show all ${count} accents` });
		const grid = themeGrid();

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(toggle).toHaveClass('lg:hidden');
		expect(grid).toHaveClass('hidden', 'lg:grid');
		const current = screen.getByTestId('current-theme');
		expect(current).toHaveTextContent('Current accent');
		expect(current).toHaveTextContent('Amber');
		expect(current).toHaveClass('lg:hidden');
		expect(current.className).not.toMatch(/(^|\s)border/);

		await fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(toggle).toHaveAccessibleName('Show fewer accents');
		expect(grid).toHaveClass('grid', 'lg:mt-0');
		expect(grid).not.toHaveClass('hidden');
		expect(screen.getByTestId('current-theme')).toBe(current);
	});

	test('the current-accent row follows the chosen accent, including a stored old theme id', async () => {
		themeStore.setTheme('vaporwave');
		render(ThemePickerCard);
		expect(screen.getByTestId('current-theme')).toHaveTextContent('Electric');

		await fireEvent.click(screen.getByRole('button', { name: /^Show all/ }));
		await fireEvent.click(themeButton('Racing green'));
		expect(screen.getByTestId('current-theme')).toHaveTextContent('Racing green');
	});

	test('marks only the active accent as pressed', () => {
		render(ThemePickerCard);
		const pressed = screen
			.getAllByRole('button')
			.filter(b => b.getAttribute('aria-pressed') === 'true');
		expect(pressed).toHaveLength(1);
		expect(pressed[0]).toHaveTextContent('Amber');
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
