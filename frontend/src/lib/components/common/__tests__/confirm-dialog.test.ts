import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ConfirmDialog from '../ConfirmDialog.svelte';

function deferred() {
	let resolve!: () => void;
	let reject!: (_error: Error) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function renderDialog(
	props: Partial<{ confirmLabel: string; cancelLabel: string; destructive: boolean }> = {},
	onConfirm: () => void | Promise<void> = vi.fn()
) {
	render(ConfirmDialog, {
		open: true,
		title: 'Delete vehicle?',
		description: 'This removes all of its expenses.',
		onConfirm,
		...props
	});
	return { onConfirm };
}

describe('ConfirmDialog', () => {
	test('renders nothing while closed', () => {
		render(ConfirmDialog, {
			open: false,
			title: 'Delete vehicle?',
			description: 'Gone forever.',
			onConfirm: vi.fn()
		});

		expect(screen.queryByText('Delete vehicle?')).toBeNull();
	});

	test('shows the title, description and default destructive labels', async () => {
		renderDialog();

		expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
		expect(screen.getByText('Delete vehicle?')).toBeInTheDocument();
		expect(screen.getByText('This removes all of its expenses.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-destructive');
	});

	test('uses custom labels and a neutral style when not destructive', async () => {
		renderDialog({ confirmLabel: 'Archive', cancelLabel: 'Keep', destructive: false });

		const confirm = await screen.findByRole('button', { name: 'Archive' });
		expect(confirm.className).not.toContain('bg-destructive');
		expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
	});

	test('confirming runs the action and then closes', async () => {
		const { onConfirm } = renderDialog();

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		expect(onConfirm).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('while the action runs it shows progress, disables both buttons and ignores repeat clicks', async () => {
		const pending = deferred();
		const onConfirm = vi.fn(() => pending.promise);
		renderDialog({}, onConfirm);

		const confirm = await screen.findByRole('button', { name: 'Delete' });
		await fireEvent.click(confirm);

		expect(confirm).toHaveTextContent('Working…');
		expect(confirm).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

		await fireEvent.click(confirm);
		expect(onConfirm).toHaveBeenCalledTimes(1);

		pending.resolve();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('a failed action keeps the dialog open so the user can retry', async () => {
		const pending = deferred();
		const onConfirm = vi.fn(() => pending.promise);
		renderDialog({}, onConfirm);

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
		pending.reject(new Error('network down'));

		const confirm = await screen.findByRole('button', { name: 'Delete' });
		expect(confirm).not.toBeDisabled();
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});

	test('cancel closes without running the action', async () => {
		const { onConfirm } = renderDialog();

		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
