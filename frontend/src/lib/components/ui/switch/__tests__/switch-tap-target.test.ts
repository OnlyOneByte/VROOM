import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';
import Switch from '../switch.svelte';

describe('Switch', () => {
	test('has a 44x26 track and a 40x40 hit area centred on it', () => {
		render(Switch, { props: { 'aria-label': 'Toggle backups' } });
		const toggle = screen.getByRole('switch', { name: 'Toggle backups' });

		expect(toggle.className).toContain('w-11');
		expect(toggle.className).toContain('h-6.5');
		expect(toggle.className).toContain('relative');
		for (const cls of ['before:absolute', 'before:size-10', 'before:left-1/2', 'before:top-1/2']) {
			expect(toggle.className).toContain(cls);
		}
	});

	test('an off thumb turns light in dark mode so it stands out from the track', () => {
		const { container } = render(Switch, { props: { 'aria-label': 'Toggle backups' } });
		const thumb = container.querySelector('[data-slot="switch-thumb"]');

		expect(thumb).toHaveAttribute('data-state', 'unchecked');
		expect(thumb).toHaveClass('bg-surface', 'dark:data-[state=unchecked]:bg-foreground');
	});

	test('still toggles when clicked', async () => {
		render(Switch, { props: { 'aria-label': 'Toggle backups' } });
		const toggle = screen.getByRole('switch', { name: 'Toggle backups' });

		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-checked', 'true');
	});
});
