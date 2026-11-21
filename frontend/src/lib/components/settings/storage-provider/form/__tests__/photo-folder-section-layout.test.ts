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
		hasClass(screen.getByText('Disable All').parentElement, 'min-h-10');
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
