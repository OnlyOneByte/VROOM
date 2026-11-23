import { afterEach, describe, expect, test, vi } from 'vitest';
import { focusFirstButton, focusLeftOn } from '../focus.ts';

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

	test('leaves focus alone when there is no container or no button', () => {
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
