import { render, screen } from '@testing-library/svelte';
import { toast } from 'svelte-sonner';
import { describe, expect, test } from 'vitest';
import { Toaster } from '../index';

describe('Toaster mounted after a toast', () => {
	test('a toast fired before the toaster loads still shows once it mounts', async () => {
		toast.error('Saved offline before the toaster loaded');

		render(Toaster);

		expect(await screen.findByText('Saved offline before the toaster loaded')).toBeInTheDocument();
	});
});
