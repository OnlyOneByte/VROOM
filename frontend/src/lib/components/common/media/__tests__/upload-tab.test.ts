import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import UploadTab from '../UploadTab.svelte';

const MB = 1024 * 1024;

interface TabProps {
	acceptedTypes: string[];
	maxFileSize: number;
	multiple: boolean;
	uploading: boolean;
	uploadIndex: number;
	uploadTotal: number;
	uploadErrors: string[];
}

function mount(overrides: Partial<TabProps> = {}) {
	const onFilesReady = vi.fn<(files: File[]) => void>();
	const onClose = vi.fn();
	const view = render(UploadTab, {
		acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
		maxFileSize: 10 * MB,
		multiple: true,
		uploading: false,
		uploadIndex: 0,
		uploadTotal: 0,
		uploadErrors: [],
		onFilesReady,
		onClose,
		...overrides
	});
	return { ...view, onFilesReady, onClose };
}

function sizedFile(name: string, type: string, bytes: number): File {
	const file = new File(['x'], name, { type });
	Object.defineProperty(file, 'size', { value: bytes });
	return file;
}

function fileInput(): HTMLInputElement {
	return document.querySelector('input[type="file"]') as HTMLInputElement;
}

async function choose(...files: File[]): Promise<void> {
	const input = fileInput();
	Object.defineProperty(input, 'files', { value: files, configurable: true });
	await fireEvent.change(input);
}

function uploadButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /Upload/ }) as HTMLButtonElement;
}

describe('UploadTab: drop zone', () => {
	test('describes the accepted formats and size limit', () => {
		mount({
			acceptedTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic']
		});

		expect(screen.getByText(/JPEG, PNG, WebP, PDF, HEIC · Max 10MB per file/)).toBeInTheDocument();
		expect(fileInput().accept).toBe('image/jpeg,image/png,image/webp,application/pdf,image/heic');
		expect(fileInput().multiple).toBe(true);
	});

	test('clicking or pressing Enter or Space on the drop zone opens the file picker', async () => {
		mount();
		const click = vi.spyOn(fileInput(), 'click');
		const zone = screen.getByRole('button', { name: /Drop files here/ });

		await fireEvent.click(zone);
		await fireEvent.keyDown(zone, { key: 'Enter' });
		await fireEvent.keyDown(zone, { key: ' ' });
		await fireEvent.keyDown(zone, { key: 'a' });

		expect(click).toHaveBeenCalledTimes(3);
	});

	test('highlights while a file is dragged over and clears on leave', async () => {
		mount();
		const zone = screen.getByRole('button', { name: /Drop files here/ });

		await fireEvent.dragOver(zone);
		expect(zone.className).toContain('border-primary bg-primary/5');

		await fireEvent.dragLeave(zone);
		expect(zone.className).not.toContain('bg-primary/5');
	});

	test('dropped files are added to the selection', async () => {
		mount();
		const zone = screen.getByRole('button', { name: /Drop files here/ });

		await fireEvent.dragOver(zone);
		await fireEvent.drop(zone, {
			dataTransfer: { files: [sizedFile('dropped.png', 'image/png', 2048)] }
		});

		expect(screen.getByText('dropped.png')).toBeInTheDocument();
		expect(screen.getByText('2.0 KB')).toBeInTheDocument();
		expect(zone.className).not.toContain('bg-primary/5');
	});

	test('a drop with no files changes nothing', async () => {
		mount();
		const zone = screen.getByRole('button', { name: /Drop files here/ });

		await fireEvent.drop(zone, { dataTransfer: { files: [] } });

		expect(uploadButton()).toBeDisabled();
	});
});

describe('UploadTab: validation', () => {
	test('rejects an unsupported file type with the allowed formats', async () => {
		mount();

		await choose(sizedFile('notes.txt', 'text/plain', 10));

		expect(
			screen.getByText('"notes.txt" is not a supported format. Allowed: JPEG, PNG, WebP.')
		).toBeInTheDocument();
		expect(uploadButton()).toBeDisabled();
	});

	test('rejects a file over the size limit', async () => {
		mount({ maxFileSize: 5 * MB });

		await choose(sizedFile('huge.jpg', 'image/jpeg', 5 * MB + 1));

		expect(screen.getByText('"huge.jpg" exceeds the 5MB size limit.')).toBeInTheDocument();
		expect(screen.queryByText('huge.jpg')).toBeNull();
	});

	test('accepts a file exactly at the size limit', async () => {
		mount({ maxFileSize: 5 * MB });

		await choose(sizedFile('edge.jpg', 'image/jpeg', 5 * MB));

		expect(screen.getByText('edge.jpg')).toBeInTheDocument();
		expect(screen.getByText('5.0 MB')).toBeInTheDocument();
	});

	test('keeps the valid files from a mixed selection and reports the rest', async () => {
		mount();

		await choose(sizedFile('ok.jpg', 'image/jpeg', 500), sizedFile('bad.gif', 'image/gif', 500));

		expect(screen.getByText('ok.jpg')).toBeInTheDocument();
		expect(screen.getByText('500 B')).toBeInTheDocument();
		expect(screen.getByText(/"bad\.gif" is not a supported format/)).toBeInTheDocument();
		expect(uploadButton()).toHaveTextContent('Upload (1)');
	});

	test('a later valid selection clears earlier validation errors', async () => {
		mount();
		await choose(sizedFile('bad.gif', 'image/gif', 500));

		await choose(sizedFile('ok.jpg', 'image/jpeg', 500));

		expect(screen.queryByText(/is not a supported format/)).toBeNull();
	});
});

describe('UploadTab: selection and upload', () => {
	test('multiple mode accumulates selections across picks', async () => {
		const { onFilesReady } = mount();
		const first = sizedFile('a.jpg', 'image/jpeg', 100);
		const second = sizedFile('b.png', 'image/png', 100);
		await choose(first);
		await choose(second);

		await fireEvent.click(uploadButton());

		expect(onFilesReady).toHaveBeenCalledWith([first, second]);
	});

	test('single mode keeps only the first valid file', async () => {
		const { onFilesReady } = mount({ multiple: false });
		const first = sizedFile('a.jpg', 'image/jpeg', 100);
		await choose(first, sizedFile('b.jpg', 'image/jpeg', 100));
		await choose(sizedFile('c.jpg', 'image/jpeg', 100));

		expect(screen.queryByText('a.jpg')).toBeNull();
		expect(screen.getByText('c.jpg')).toBeInTheDocument();
		expect(fileInput().multiple).toBe(false);
		await fireEvent.click(uploadButton());
		expect(onFilesReady).toHaveBeenCalledWith([expect.objectContaining({ name: 'c.jpg' })]);
	});

	test('removing a file drops it from the selection', async () => {
		const { onFilesReady } = mount();
		const keep = sizedFile('keep.jpg', 'image/jpeg', 100);
		await choose(sizedFile('drop.jpg', 'image/jpeg', 100), keep);

		const row = screen.getByText('drop.jpg').closest('div')?.parentElement as HTMLElement;
		await fireEvent.click(row.querySelector('button') as HTMLButtonElement);

		expect(screen.queryByText('drop.jpg')).toBeNull();
		await fireEvent.click(uploadButton());
		expect(onFilesReady).toHaveBeenCalledWith([keep]);
	});

	test('the upload button does nothing with no files selected', async () => {
		const { onFilesReady } = mount();

		await fireEvent.click(uploadButton());

		expect(uploadButton()).toBeDisabled();
		expect(onFilesReady).not.toHaveBeenCalled();
	});

	test('an empty pick is ignored', async () => {
		mount();

		await choose();

		expect(uploadButton()).toHaveTextContent(/^Upload\s*$/);
	});

	test('reset clears the selection and errors', async () => {
		const { component } = mount();
		await choose(sizedFile('a.jpg', 'image/jpeg', 100), sizedFile('x.txt', 'text/plain', 1));

		component.reset();
		await Promise.resolve();

		expect(screen.queryByText('a.jpg')).toBeNull();
		expect(screen.queryByText(/is not a supported format/)).toBeNull();
	});

	test('cancel calls onClose', async () => {
		const { onClose } = mount();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(onClose).toHaveBeenCalledOnce();
	});
});

describe('UploadTab: progress and errors', () => {
	test('shows progress and hides the drop zone while uploading', () => {
		mount({ uploading: true, uploadIndex: 1, uploadTotal: 3 });

		expect(screen.getByText('Uploading 2 of 3...')).toBeInTheDocument();
		expect(screen.queryByText('Drop files here or click to browse')).toBeNull();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		expect(screen.getByRole('button', { name: /Uploading\.\.\.$/ })).toBeDisabled();
	});

	test('lists upload errors reported by the dialog', () => {
		mount({ uploadErrors: ['Failed to upload "a.jpg"', 'Storage quota exceeded'] });

		expect(screen.getByText('Failed to upload "a.jpg"')).toBeInTheDocument();
		expect(screen.getByText('Storage quota exceeded')).toBeInTheDocument();
	});
});
