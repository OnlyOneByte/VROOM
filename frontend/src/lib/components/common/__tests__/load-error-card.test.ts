import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import LoadErrorCard from '../LoadErrorCard.svelte';

function mount(onRetry: () => unknown) {
	return render(LoadErrorCard, {
		title: "Couldn't load analytics",
		message: 'Server unavailable.',
		onRetry
	});
}

function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>(r => (resolve = r));
	return { promise, resolve };
}

afterEach(() => {
	document.querySelector('main')?.remove();
});

describe('LoadErrorCard', () => {
	test('shows the title and message in an alert, with a 40px Retry', () => {
		mount(() => {});

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent("Couldn't load analytics");
		expect(alert).toHaveTextContent('Server unavailable.');
		expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('h-10');
	});

	test('Retry stays focusable while it runs and ignores a second press', async () => {
		const pending = deferred();
		const onRetry = vi.fn(() => pending.promise);
		mount(onRetry);
		const button = screen.getByRole('button', { name: 'Retry' });
		button.focus();

		await fireEvent.click(button);
		await fireEvent.click(screen.getByRole('button', { name: /Retrying/ }));

		expect(onRetry).toHaveBeenCalledTimes(1);
		const running = screen.getByRole('button', { name: /Retrying/ });
		expect(running).toHaveAttribute('aria-disabled', 'true');
		expect(document.activeElement).toBe(running);
		pending.resolve();
	});

	test('a retry that fails again keeps the card, the new message and focus on Retry', async () => {
		const view = mount(async () => {
			await view.rerender({ message: 'Still unavailable.' });
		});
		const button = screen.getByRole('button', { name: 'Retry' });
		button.focus();

		await fireEvent.click(button);

		const again = await screen.findByRole('button', { name: 'Retry' });
		expect(screen.getByRole('alert')).toHaveTextContent('Still unavailable.');
		expect(document.activeElement).toBe(again);
	});

	test('a retry that loads moves focus to the page heading', async () => {
		const main = document.createElement('main');
		main.innerHTML = '<h1>Analytics Dashboard</h1>';
		document.body.append(main);
		const view = mount(async () => {
			view.unmount();
		});
		screen.getByRole('button', { name: 'Retry' }).focus();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('heading', { name: 'Analytics Dashboard' })
			)
		);
	});

	test('a retry that loads leaves focus alone once the user has moved on', async () => {
		const main = document.createElement('main');
		main.innerHTML = '<h1>Analytics Dashboard</h1><button>Elsewhere</button>';
		document.body.append(main);
		const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
		const pending = deferred();
		const view = mount(async () => {
			await pending.promise;
			view.unmount();
		});
		screen.getByRole('button', { name: 'Retry' }).focus();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		elsewhere.focus();
		pending.resolve();

		await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		expect(document.activeElement).toBe(elsewhere);
	});

	test('passes a test id to the card and keeps the 40px Retry in the compact variant', () => {
		const { container } = render(LoadErrorCard, {
			title: "Couldn't load who has access",
			message: 'Server unavailable.',
			onRetry: () => {},
			compact: true,
			'data-testid': 'share-load-error'
		});

		const card = screen.getByTestId('share-load-error');
		expect(card).toBe(container.querySelector('[data-slot="load-error-card"]'));
		expect(card).toHaveClass('p-4');
		expect(card).not.toHaveClass('p-6');
		expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('h-10');
	});

	test('a compact retry that loads moves focus to the first button around it, not the page heading', async () => {
		const main = document.createElement('main');
		main.innerHTML = '<h1>Vehicle</h1><div id="dialog"></div>';
		document.body.append(main);
		const dialog = main.querySelector('#dialog') as HTMLElement;
		const view = render(LoadErrorCard, {
			target: dialog,
			props: {
				title: "Couldn't load who has access",
				message: 'Server unavailable.',
				compact: true,
				onRetry: async () => {
					view.unmount();
					dialog.innerHTML = '<button>Invite</button>';
				}
			}
		});
		screen.getByRole('button', { name: 'Retry' }).focus();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Invite' }))
		);
	});

	test('onRecovered replaces the default focus move after a retry that loads', async () => {
		const main = document.createElement('main');
		main.innerHTML = '<h1>All Expenses</h1><h2 tabindex="-1">Expenses (3)</h2>';
		document.body.append(main);
		const listHeading = screen.getByRole('heading', { name: 'Expenses (3)' });
		const view = render(LoadErrorCard, {
			title: "Couldn't load expenses",
			message: 'Server unavailable.',
			onRetry: async () => {
				view.unmount();
			},
			onRecovered: () => listHeading.focus()
		});
		screen.getByRole('button', { name: 'Retry' }).focus();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(document.activeElement).toBe(listHeading));
	});
});
