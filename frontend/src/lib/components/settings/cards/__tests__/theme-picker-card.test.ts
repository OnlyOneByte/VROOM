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
	const toggle = screen.getByRole('button', { name: /themes$/ });
	const grid = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
	if (!grid) throw new Error('theme grid missing');
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
	test('lists every registered theme with its label and description', () => {
		render(ThemePickerCard);
		const grid = within(themeGrid());
		for (const theme of Object.values(THEME_REGISTRY)) {
			expect(grid.getByText(theme.label)).toBeInTheDocument();
			expect(grid.getByText(theme.description)).toBeInTheDocument();
		}
	});

	test('below lg the grid starts collapsed behind the current theme and a Show all toggle', async () => {
		render(ThemePickerCard);
		const count = Object.keys(THEME_REGISTRY).length;
		const toggle = screen.getByRole('button', { name: `Show all ${count} themes` });
		const grid = themeGrid();

		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		expect(toggle).toHaveClass('lg:hidden');
		expect(grid).toHaveClass('hidden', 'lg:grid');
		const current = screen.getByTestId('current-theme');
		expect(current).toHaveTextContent('Current theme');
		expect(current).toHaveTextContent('Default');
		expect(current).toHaveClass('lg:hidden');
		expect(current.className).not.toMatch(/(^|\s)border/);

		await fireEvent.click(toggle);

		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		expect(toggle).toHaveAccessibleName('Show fewer themes');
		expect(grid).toHaveClass('grid', 'lg:mt-0');
		expect(grid).not.toHaveClass('hidden');
		expect(screen.getByTestId('current-theme')).toBe(current);
	});

	test('the current-theme row follows the chosen theme', async () => {
		themeStore.setTheme('vaporwave');
		render(ThemePickerCard);
		expect(screen.getByTestId('current-theme')).toHaveTextContent(THEME_REGISTRY.vaporwave.label);

		await fireEvent.click(screen.getByRole('button', { name: /^Show all/ }));
		await fireEvent.click(themeButton(THEME_REGISTRY.blueprint.label));
		expect(screen.getByTestId('current-theme')).toHaveTextContent(THEME_REGISTRY.blueprint.label);
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
