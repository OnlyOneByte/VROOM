// Table row accessibility: keyboard-operable split groups, no nested interactive controls, named row controls, and an explained disabled Delete.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import ExpensesTable from '../ExpensesTable.svelte';
import { appStore } from '$lib/stores/app.svelte';
import type { Expense, Vehicle } from '$lib/types';

const VEHICLE: Vehicle = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	trackFuel: true,
	trackCharging: false,
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const rowBase = {
	vehicleId: VEHICLE.id,
	userId: 'u1',
	createdAt: '2024-03-12T12:00:00.000Z',
	updatedAt: '2024-03-12T12:00:00.000Z'
};

const EXPENSES: Expense[] = [
	{
		...rowBase,
		id: 'e-standalone',
		tags: [],
		category: 'fuel',
		amount: 45.5,
		date: '2024-03-15T12:00:00.000Z'
	},
	{
		...rowBase,
		id: 'g-plain-a',
		tags: [],
		category: 'maintenance',
		amount: 60,
		date: '2024-03-12T12:00:00.000Z',
		groupId: 'g-plain'
	},
	{
		...rowBase,
		id: 'g-plain-b',
		tags: [],
		category: 'maintenance',
		amount: 40,
		date: '2024-03-12T12:00:00.000Z',
		groupId: 'g-plain'
	},
	{
		...rowBase,
		id: 'g-ins-a',
		tags: ['insurance'],
		category: 'financial',
		amount: 120,
		date: '2024-03-01T12:00:00.000Z',
		groupId: 'g-ins'
	},
	{
		...rowBase,
		id: 'g-ins-b',
		tags: ['insurance'],
		category: 'financial',
		amount: 80,
		date: '2024-03-01T12:00:00.000Z',
		groupId: 'g-ins'
	}
];

const INSURANCE_REASON = 'Delete the insurance policy to remove this expense';

const INTERACTIVE = 'a[href], button, [role="button"], input, select, textarea, [tabindex]';

/** `INTERACTIVE` narrowed to one ancestor. Prefixing the string would scope only its first member. */
function scopeTo(ancestor: string) {
	return INTERACTIVE.split(', ')
		.map(selector => `${ancestor} ${selector}`)
		.join(', ');
}

function mountTable(props: Record<string, unknown> = {}) {
	return render(ExpensesTable, {
		expenses: EXPENSES,
		vehicles: [VEHICLE],
		onDelete: async () => {},
		...props
	});
}

function useLayout(layout: 'compact' | 'wide') {
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: layout === 'compact',
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
}

function nestedInteractive(container: HTMLElement) {
	return [...container.querySelectorAll<HTMLElement>(INTERACTIVE)]
		.filter(el => el.querySelector(INTERACTIVE) !== null)
		.map(el => `${el.tagName}[${el.getAttribute('class')?.slice(0, 40)}]`);
}

function accessibleName(el: Element) {
	return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// Keydown then click, as a browser does: a handler that unmounts the control during keydown swallows the activation.
async function pressKey(el: HTMLElement, key: 'Enter' | ' ') {
	el.focus();
	await fireEvent.keyDown(el, { key, bubbles: true });
	if (el.isConnected) await fireEvent.click(el);
	if (el.isConnected) await fireEvent.keyUp(el, { key, bubbles: true });
}

function confirmationDialog() {
	return document.body.querySelector('[role="alertdialog"]');
}

// Innermost match: the first match in document order would measure a row that contains the intended button.
function byText<T extends Element>(root: HTMLElement, selector: string, text: string) {
	const match = [...root.querySelectorAll<T>(selector)].find(
		el => el.textContent?.includes(text) && el.querySelector(INTERACTIVE) === null
	);
	if (!match) throw new Error(`no leaf ${selector} containing "${text}"`);
	return match;
}

function compactRows(container: HTMLElement) {
	const list = container.querySelector('.divide-y');
	if (!list) throw new Error('the compact layout rendered no rows container');
	return [...list.children] as HTMLElement[];
}

function compactRow(container: HTMLElement, text: string) {
	const row = compactRows(container).find(el => el.textContent?.includes(text));
	if (!row) throw new Error(`no compact row containing "${text}"`);
	return row;
}

function compactRowsWith(container: HTMLElement, text: string) {
	return compactRows(container).filter(el => el.textContent?.includes(text));
}

function groupRow(container: HTMLElement, label: string) {
	const row = [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(
		tr => tr.textContent?.includes('Split') && tr.textContent?.includes(label)
	);
	if (!row) throw new Error(`no split group row containing "${label}"`);
	return row;
}

function disclosure(row: HTMLElement) {
	const button = row.querySelector<HTMLElement>('[aria-expanded]');
	if (!button) throw new Error('the split group row exposes no control reporting expanded state');
	return button;
}

function bodyRowCount(container: HTMLElement) {
	return container.querySelectorAll('tbody tr').length;
}

beforeEach(() => {
	appStore.clearNotifications();
	useLayout('wide');
});

describe('wide layout: a split group opens by keyboard, not only by mouse', () => {
	test('the disclosure is a real, named control that reports the expanded state', () => {
		const { container } = mountTable();
		const toggle = disclosure(groupRow(container, 'Maintenance'));

		// A `<tr>` with a click handler is not focusable and has no state: the control has to be a
		// real button for Tab to reach it and for anything to announce collapsed/expanded.
		expect(toggle.tagName).toBe('BUTTON');
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		expect(accessibleName(toggle)).not.toBe('');
	});

	test('Enter reveals the per-vehicle portions and collapses them again', async () => {
		const { container } = mountTable();
		const collapsed = bodyRowCount(container);
		const toggle = disclosure(groupRow(container, 'Maintenance'));

		await pressKey(toggle, 'Enter');

		expect(bodyRowCount(container)).toBe(collapsed + 2);
		expect(disclosure(groupRow(container, 'Maintenance')).getAttribute('aria-expanded')).toBe(
			'true'
		);
		expect(byText(container, 'tbody tr', '$60.00')).toBeTruthy();

		await pressKey(disclosure(groupRow(container, 'Maintenance')), 'Enter');

		expect(bodyRowCount(container)).toBe(collapsed);
		expect(disclosure(groupRow(container, 'Maintenance')).getAttribute('aria-expanded')).toBe(
			'false'
		);
	});

	test('Space reveals them too', async () => {
		const { container } = mountTable();
		const collapsed = bodyRowCount(container);

		await pressKey(disclosure(groupRow(container, 'Maintenance')), ' ');

		expect(bodyRowCount(container)).toBe(collapsed + 2);
	});

	test('one click on the disclosure expands once — the row handler must not fire too', async () => {
		const { container } = mountTable();
		const collapsed = bodyRowCount(container);

		await fireEvent.click(disclosure(groupRow(container, 'Maintenance')));

		// Without `stopPropagation` the row's own toggle would run as well and cancel this one out.
		expect(bodyRowCount(container)).toBe(collapsed + 2);
	});

	test('a click anywhere on the row still toggles, as it does today', async () => {
		const { container } = mountTable();
		const collapsed = bodyRowCount(container);

		await fireEvent.click(groupRow(container, 'Maintenance'));

		expect(bodyRowCount(container)).toBe(collapsed + 2);
	});
});

describe('wide layout: row controls are visible when focused and named when icon-only', () => {
	test('every cluster hidden at opacity 0 reveals itself on focus, not on hover alone', () => {
		const { container } = mountTable();
		const hidden = [...container.querySelectorAll('[class*="opacity-0"]')];

		// The clusters exist; if this ever reaches zero the assertion below proves nothing.
		expect(hidden.length).toBeGreaterThan(0);
		for (const cluster of hidden) {
			const classes = cluster.getAttribute('class') ?? '';
			// Any variant of the focus escape counts (`focus-within:`, `group-focus-within:`,
			// `lg:group-focus-within:`); having none would make the assertion vacuous.
			const revealedByFocus = classes
				.split(/\s+/)
				.some(token => token.endsWith('focus-within:opacity-100'));
			expect(
				revealedByFocus,
				`a focusable cluster is hidden with no focus escape: ${classes}`
			).toBe(true);
		}
	});

	test('no row control is nameless', () => {
		const { container } = mountTable();
		const controls = [...container.querySelectorAll(scopeTo('tbody'))];

		expect(controls.length).toBeGreaterThan(0);
		for (const control of controls) {
			// `title` is deliberately NOT accepted: the house rule is `aria-label` on icon-only
			// controls, and a title is also unreachable by touch and by keyboard.
			expect(
				accessibleName(control),
				`nameless control: ${control.outerHTML.slice(0, 120)}`
			).not.toBe('');
		}
	});
});

describe('compact layout: a row never nests one control inside another', () => {
	beforeEach(() => useLayout('compact'));

	test('collapsed rows nest nothing', () => {
		const { container } = mountTable();

		expect(nestedInteractive(container)).toEqual([]);
	});

	test('a standalone row with its actions revealed nests nothing', async () => {
		const { container } = mountTable();
		const summary = byText<HTMLElement>(container, 'button', 'Fuel & Charging');

		await fireEvent.click(summary);

		expect(byText(container, 'a[href]', 'Edit')).toBeTruthy();
		expect(byText(container, 'button', 'Delete')).toBeTruthy();
		expect(nestedInteractive(container)).toEqual([]);
		// The row button's name is its summary, not a run-on that swallows its own actions.
		expect(accessibleName(summary)).not.toMatch(/Edit|Delete/);
	});

	test('a split row with its actions revealed nests nothing', async () => {
		const { container } = mountTable();
		const summary = byText<HTMLElement>(container, 'button', 'Maintenance');

		await fireEvent.click(summary);

		expect(byText(container, 'button', 'Delete')).toBeTruthy();
		expect(nestedInteractive(container)).toEqual([]);
		expect(accessibleName(summary)).not.toMatch(/Edit|Delete/);
	});

	test('a read-only row is not a control, because it has nothing to reveal', () => {
		const { container } = mountTable({ canWrite: false });
		const row = compactRow(container, 'Fuel & Charging');

		// Use matches as well as querySelector: the row itself can be the button, which a descendants-only query misses.
		expect(row.matches(INTERACTIVE)).toBe(false);
		expect(row.querySelector(INTERACTIVE)).toBeNull();
	});
});

describe('compact layout: rows and their actions are operable by keyboard', () => {
	beforeEach(() => useLayout('compact'));

	test('Enter on a row reveals its actions and reports the state', async () => {
		const { container } = mountTable();
		const summary = byText<HTMLElement>(container, 'button', 'Fuel & Charging');

		expect(summary.getAttribute('aria-expanded')).toBe('false');

		await pressKey(summary, 'Enter');

		expect(summary.getAttribute('aria-expanded')).toBe('true');
		expect(byText(container, 'button', 'Delete')).toBeTruthy();
	});

	test('Enter on a split row reveals its per-vehicle portions', async () => {
		const { container } = mountTable();

		await pressKey(byText<HTMLElement>(container, 'button', 'Maintenance'), 'Enter');

		expect(compactRowsWith(container, '$60.00')).toHaveLength(1);
		expect(compactRowsWith(container, '$40.00')).toHaveLength(1);
	});

	for (const key of ['Enter', ' '] as const) {
		test(`${key === ' ' ? 'Space' : 'Enter'} on a split row's Delete opens the confirmation`, async () => {
			const { container } = mountTable();
			await fireEvent.click(byText<HTMLElement>(container, 'button', 'Maintenance'));
			const del = byText<HTMLElement>(container, 'button', 'Delete');

			await pressKey(del, key);

			// A keydown on the row must not deselect it, which would unmount the button mid-press.
			expect(del.isConnected).toBe(true);
			expect(confirmationDialog()?.textContent).toContain('split expense');
		});
	}

	test("Enter on a standalone row's Delete opens the confirmation", async () => {
		const { container } = mountTable();
		await fireEvent.click(byText<HTMLElement>(container, 'button', 'Fuel & Charging'));
		const del = byText<HTMLElement>(container, 'button', 'Delete');

		await pressKey(del, 'Enter');

		expect(confirmationDialog()).not.toBeNull();
	});
});

describe('a Delete owned by an insurance policy explains itself', () => {
	test('wide layout: focusable, announced as disabled, and described by its reason', () => {
		const { container } = mountTable();
		const del = groupRow(container, 'Financial').querySelector<HTMLButtonElement>(
			'button[aria-disabled]'
		)!;

		expect(del).not.toBeNull();
		// `disabled` would take it out of the tab order, which is what made the reason unreachable.
		expect(del.disabled).toBe(false);
		del.focus();
		expect(document.activeElement).toBe(del);
		expect(del.getAttribute('aria-disabled')).toBe('true');

		const describedBy = del.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy!)?.textContent).toBe(INSURANCE_REASON);
		expect(del.getAttribute('title')).toBe(INSURANCE_REASON);
		// The kit dims an aria-disabled control AND kills its pointer events; the second half has
		// to be undone or the hover tooltip never fires and the click below never happens.
		const classes = (del.getAttribute('class') ?? '').split(/\s+/);
		expect(classes).not.toContain('aria-disabled:pointer-events-none');
		expect(classes).toContain('aria-disabled:pointer-events-auto');
	});

	test('wide layout: activating it explains instead of doing nothing visible', async () => {
		const { container } = mountTable();
		const del = groupRow(container, 'Financial').querySelector<HTMLElement>(
			'button[aria-disabled]'
		)!;

		await pressKey(del, 'Enter');

		expect(confirmationDialog()).toBeNull();
		expect(appStore.notifications.map(n => n.message)).toContain(INSURANCE_REASON);
	});

	test('compact layout: same control, same explanation', async () => {
		useLayout('compact');
		const { container } = mountTable();
		await fireEvent.click(byText<HTMLElement>(container, 'button', 'Financial'));
		const del = container.querySelector<HTMLButtonElement>('button[aria-disabled]')!;

		expect(del).not.toBeNull();
		expect(del.disabled).toBe(false);
		expect(del.textContent).toContain('Delete');
		expect(document.getElementById(del.getAttribute('aria-describedby')!)?.textContent).toBe(
			INSURANCE_REASON
		);

		await pressKey(del, 'Enter');

		expect(confirmationDialog()).toBeNull();
		expect(appStore.notifications.map(n => n.message)).toContain(INSURANCE_REASON);
	});

	test('a split group with no insurance tag is still deletable', async () => {
		const { container } = mountTable();
		const del = [
			...groupRow(container, 'Maintenance').querySelectorAll<HTMLElement>('button')
		].find(b => b.getAttribute('aria-label') === 'Delete expense')!;

		expect(del.getAttribute('aria-disabled')).toBeNull();

		await pressKey(del, 'Enter');

		expect(confirmationDialog()?.textContent).toContain('split expense');
	});
});
