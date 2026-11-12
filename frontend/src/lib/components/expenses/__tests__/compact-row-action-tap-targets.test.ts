import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import ExpensesTable from '../ExpensesTable.svelte';
import type { Expense } from '$lib/types';

const SPACING_PX = 4;
const TAP_TARGET_FLOOR_PX = 40;

const EXPENSES: Expense[] = [
	{
		id: 'e-standalone',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 45.5,
		date: '2024-03-15T12:00:00.000Z',
		tags: [],
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z'
	}
] as unknown as Expense[];

function useCompactLayout() {
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: true,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
}

function spacing(classes: string, pattern: RegExp): number | null {
	const match = classes.match(pattern);
	return match ? Number(match[1]) * SPACING_PX : null;
}

async function revealRowActions() {
	const { container } = render(ExpensesTable, {
		expenses: EXPENSES,
		onDelete: async () => {}
	});

	const rows = container.querySelector('.divide-y');
	if (!rows) throw new Error('the compact layout rendered no rows container');
	const summary = rows.querySelector<HTMLButtonElement>('button[aria-expanded]');
	if (!summary) throw new Error('the compact layout rendered no row disclosure');
	await fireEvent.click(summary);

	const row = summary.parentElement;
	const controls = [...(row?.querySelectorAll<HTMLElement>('a, button') ?? [])];
	const named = (text: string) => {
		const control = controls.find(el => el.textContent?.trim() === text);
		if (!control) throw new Error(`the revealed strip has no ${text} control`);
		return control;
	};

	const edit = named('Edit');
	const strip = edit.parentElement;
	if (!strip) throw new Error('the revealed controls have no containing strip');

	return { strip, edit, del: named('Delete') };
}

describe('the compact row action pair', () => {
	beforeEach(useCompactLayout);

	test('clears the tap-target floor through its hit area, not its drawn size', async () => {
		const { edit, del } = await revealRowActions();

		for (const control of [edit, del]) {
			const classes = control.getAttribute('class') ?? '';
			const label = control.textContent?.trim();

			const drawnHeight = spacing(classes, /\bh-([\d.]+)\b/);
			const overhang = spacing(classes, /\bbefore:-inset-y-([\d.]+)\b/);

			expect(drawnHeight, `${label} sets no height`).not.toBeNull();
			expect(overhang, `${label} has no vertical hit area`).not.toBeNull();

			expect(classes, `${label}'s hit area has no positioning context`).toContain('relative');
			expect(classes).toContain('before:absolute');
			expect(classes, `${label}'s hit area is not pinned to its own width`).toContain(
				'before:inset-x-0'
			);
			expect(classes).toContain("before:content-['']");

			expect(
				drawnHeight! + 2 * overhang!,
				`${label} is ${drawnHeight}px drawn with ${overhang}px of overhang per side`
			).toBeGreaterThanOrEqual(TAP_TARGET_FLOOR_PX);
		}
	});

	test('keeps its hit area inside the revealed strip', async () => {
		const { strip, edit } = await revealRowActions();

		const overhang = spacing(edit.getAttribute('class') ?? '', /\bbefore:-inset-y-([\d.]+)\b/);
		const stripPadTop = spacing(strip.getAttribute('class') ?? '', /\bpt-([\d.]+)\b/);

		expect(stripPadTop, 'the action strip does not pad for the hit area above it').not.toBeNull();
		expect(stripPadTop!).toBeGreaterThanOrEqual(overhang!);
	});
});
