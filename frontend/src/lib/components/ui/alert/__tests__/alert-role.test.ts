import { render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import { Alert } from '../index';

describe('Alert role', () => {
	test('defaults to an alert, which screen readers announce immediately', () => {
		render(Alert);
		expect(screen.getByRole('alert')).toBeInTheDocument();
		expect(screen.queryByRole('status')).toBeNull();
	});

	test('a caller can make it a polite status for non-urgent notices', () => {
		render(Alert, { role: 'status' });
		expect(screen.getByRole('status')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
