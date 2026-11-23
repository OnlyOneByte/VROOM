import { afterEach, describe, expect, test, vi } from 'vitest';
import { focusFirstButton, focusFirstProblem, focusLeftOn } from '../focus.ts';

afterEach(() => {
	document.body.innerHTML = '';
});

function button(label: string): HTMLButtonElement {
	const el = document.createElement('button');
	el.textContent = label;
	document.body.append(el);
	return el;
}

describe('focusLeftOn', () => {
	test('is true while focus is still on the origin', () => {
		const origin = button('Retry');
		origin.focus();

		expect(focusLeftOn(origin)).toBe(true);
	});

	test('is true when the origin unmounted and focus fell to the body', () => {
		const origin = button('Retry');
		origin.focus();
		origin.remove();

		expect(document.activeElement).toBe(document.body);
		expect(focusLeftOn(origin)).toBe(true);
	});

	test('is true when nothing is focused', () => {
		const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
		try {
			expect(focusLeftOn(button('Retry'))).toBe(true);
		} finally {
			active.mockRestore();
		}
	});

	test('is false once the user moved focus elsewhere', () => {
		const origin = button('Retry');
		origin.focus();
		button('Other').focus();

		expect(focusLeftOn(origin)).toBe(false);
	});
});

describe('focusFirstButton', () => {
	test('focuses the first button inside the container', () => {
		const container = document.createElement('div');
		container.innerHTML = '<p>Loaded</p><button>Add</button><button>Edit</button>';
		document.body.append(container);

		focusFirstButton(container);

		expect(document.activeElement?.textContent).toBe('Add');
	});

	test('focuses a focusable container when it holds no button', () => {
		const container = document.createElement('div');
		container.tabIndex = -1;
		container.innerHTML = '<p>Notifications are on</p>';
		document.body.append(container);

		focusFirstButton(container);

		expect(document.activeElement).toBe(container);
	});

	test('leaves focus alone when there is no container, or no button in an unfocusable one', () => {
		const origin = button('Retry');
		origin.focus();
		const empty = document.createElement('div');
		document.body.append(empty);

		focusFirstButton(null);
		focusFirstButton(undefined);
		focusFirstButton(empty);

		expect(document.activeElement).toBe(origin);
	});
});

describe('focusFirstProblem', () => {
	test('focuses the first invalid field in the form', async () => {
		const form = document.createElement('form');
		form.innerHTML =
			'<input id="ok" /><input id="bad" aria-invalid="true" /><input id="later" aria-invalid="true" />';
		document.body.append(form);

		await focusFirstProblem(form);

		expect(document.activeElement?.id).toBe('bad');
	});

	test('falls back to the submit error when no field is invalid', async () => {
		const form = document.createElement('form');
		form.innerHTML = '<input id="ok" /><p id="submit-error" tabindex="-1">Could not save</p>';
		document.body.append(form);

		await focusFirstProblem(form);

		expect(document.activeElement?.id).toBe('submit-error');
	});

	test('leaves focus alone when nothing is wrong', async () => {
		const origin = button('Save');
		origin.focus();
		const form = document.createElement('form');
		form.innerHTML = '<input id="ok" />';
		document.body.append(form);

		await focusFirstProblem(form);
		await focusFirstProblem(null);

		expect(document.activeElement).toBe(origin);
	});
});
