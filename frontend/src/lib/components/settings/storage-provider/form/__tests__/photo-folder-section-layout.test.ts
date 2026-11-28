import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { CategorySetting, PhotoCategory } from '#lib/types/index.ts';
import PhotoFolderSection from '../PhotoFolderSection.svelte';

const setting = (folderPath: string): CategorySetting => ({ enabled: true, folderPath });
const categorySettings: Record<PhotoCategory, CategorySetting> = {
	vehicle_photos: setting('/Vehicle'),
	expense_receipts: setting('/Receipts'),
	insurance_docs: setting('/Insurance'),
	odometer_readings: setting('/Odometer')
};

const hasClass = (el: Element | null | undefined, cls: string) =>
	expect(el?.className).toMatch(new RegExp(`(^|\\s)${cls}(\\s|$)`));

describe('PhotoFolderSection rows on phones', () => {
	test('rows are 40px tall, 8px apart, and the path input wraps and shrinks instead of overflowing', async () => {
		render(PhotoFolderSection, {
			props: {
				photoRootPath: 'photos',
				categorySettings,
				providerRootPath: 'VROOM',
				onUpdate: vi.fn()
			}
		});
		await fireEvent.click(screen.getByText('Category paths & sync settings'));

		const rows = await screen.findAllByTestId('photo-folder-row');
		expect(rows).toHaveLength(4);
		hasClass(rows[0]?.parentElement, 'space-y-2');
		hasClass(screen.getByText('Disable all').parentElement, 'min-h-10');
		for (const row of rows) {
			hasClass(row, 'flex-wrap');
			hasClass(row, 'gap-y-2');
			hasClass(row.querySelector('[role="checkbox"]')?.nextElementSibling, 'min-h-10');
			const input = row.querySelector('input');
			hasClass(input, 'min-w-0');
			hasClass(input?.parentElement, 'min-w-0');
			hasClass(input?.parentElement, 'basis-full');
			hasClass(input?.parentElement, 'h-10');
		}
	});
});

describe('PhotoFolderSection accessible names', () => {
	test('every checkbox is named by its visible label, and every path input names its category', async () => {
		const onUpdate = vi.fn();
		render(PhotoFolderSection, {
			props: { photoRootPath: 'photos', categorySettings, providerRootPath: 'VROOM', onUpdate }
		});
		await fireEvent.click(screen.getByText('Category paths & sync settings'));

		expect(await screen.findByRole('checkbox', { name: 'Disable all' })).toBeInTheDocument();
		for (const name of [
			'Vehicle photos',
			'Expense receipts',
			'Insurance docs',
			'Odometer readings'
		]) {
			expect(screen.getByRole('checkbox', { name })).toBeInTheDocument();
			expect(screen.getByRole('textbox', { name: `${name} folder path` })).toBeInTheDocument();
		}

		await fireEvent.click(screen.getByText('Vehicle photos'));
		expect(onUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ vehicle_photos: { enabled: false, folderPath: '/Vehicle' } })
		);
	});
});
