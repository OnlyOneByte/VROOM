import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, test } from 'vitest';
import FormFieldError from '../form-field-error.svelte';

const message = createRawSnippet(() => ({
	render: () => '<span>Amount must be greater than 0</span>'
}));

describe('FormFieldError', () => {
	test('announces through one live role, an alert with no competing aria-live', () => {
		render(FormFieldError, { props: { id: 'amount-error', children: message } });
		const error = screen.getByRole('alert');

		expect(error).toHaveTextContent('Amount must be greater than 0');
		expect(error).toHaveAttribute('id', 'amount-error');
		expect(error).not.toHaveAttribute('aria-live');
	});
});
