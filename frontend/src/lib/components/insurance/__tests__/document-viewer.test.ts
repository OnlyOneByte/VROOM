import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { PaginatedResponse, Photo } from '#lib/types/index.ts';
import { makePhoto as photo, photoPage as page, settle } from './insurance-fixtures.ts';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const getEntityDocuments =
	vi.fn<(entityType: string, entityId: string) => Promise<PaginatedResponse<Photo>>>();
const uploadEntityDocument =
	vi.fn<(entityType: string, entityId: string, file: File) => Promise<Photo>>();
const deleteEntityDocument =
	vi.fn<(entityType: string, entityId: string, photoId: string) => Promise<void>>();

vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: {
		getEntityDocuments: (entityType: string, entityId: string) =>
			getEntityDocuments(entityType, entityId),
		uploadEntityDocument: (entityType: string, entityId: string, file: File) =>
			uploadEntityDocument(entityType, entityId, file),
		deleteEntityDocument: (entityType: string, entityId: string, photoId: string) =>
			deleteEntityDocument(entityType, entityId, photoId),
		getEntityDocumentThumbnailUrl: (entityType: string, entityId: string, photoId: string) =>
			`/api/v1/photos/${entityType}/${entityId}/${photoId}/thumbnail`
	}
}));

const handleErrorWithNotification = vi.fn<(error: unknown, context?: string) => void>();
vi.mock('#lib/utils/error-handling.ts', () => ({
	handleErrorWithNotification: (error: unknown, context?: string) =>
		handleErrorWithNotification(error, context),
	logLoadFailure: vi.fn(),
	userFacingErrorMessage: () => 'Something went wrong.'
}));

interface CaptureDialogProps {
	open: boolean;
	title?: string;
	acceptedTypes?: string[];
	onUpload: (_file: File) => Promise<unknown>;
	onUploadComplete?: (_result: unknown) => void;
	onClose: () => void;
}

let captureProps: CaptureDialogProps | null = null;
vi.mock('#lib/components/common/MediaCaptureDialog.svelte', () => ({
	default: (_anchor: unknown, props: CaptureDialogProps) => {
		captureProps = props;
	}
}));

const DocumentViewer = (await import('../DocumentViewer.svelte')).default;

function mount(props: { entityType?: string; readOnly?: boolean } = {}) {
	return render(DocumentViewer, { props: { entityId: 'p1', ...props } });
}

function dialogProps(): CaptureDialogProps {
	if (!captureProps) throw new Error('MediaCaptureDialog was not rendered');
	return captureProps;
}

beforeEach(() => {
	vi.clearAllMocks();
	captureProps = null;
	getEntityDocuments.mockResolvedValue(page([]));
});

afterEach(() => {
	cleanup();
});

describe('DocumentViewer loading', () => {
	test('shows a spinner until the documents request resolves', async () => {
		getEntityDocuments.mockReturnValue(new Promise(() => {}));
		const { container } = mount();
		await settle();
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByText('No documents uploaded yet.')).toBeNull();
	});

	test('defaults to the insurance_policy entity type', async () => {
		mount();
		await settle();
		expect(getEntityDocuments).toHaveBeenCalledWith('insurance_policy', 'p1');
	});

	test('uses the given entity type for every API call', async () => {
		getEntityDocuments.mockResolvedValue(page([photo({ mimeType: 'application/pdf' })]));
		mount({ entityType: 'insurance_claim' });
		await settle();
		expect(getEntityDocuments).toHaveBeenCalledWith('insurance_claim', 'p1');
		expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
			'href',
			'/api/v1/photos/insurance_claim/p1/d1/thumbnail'
		);
	});

	test('shows the empty state when there are no documents', async () => {
		mount();
		await settle();
		expect(screen.getByText('No documents uploaded yet.')).toBeInTheDocument();
	});

	test('notifies and falls back to the empty state when loading fails', async () => {
		const failure = new Error('offline');
		getEntityDocuments.mockRejectedValue(failure);
		mount();
		await settle();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(
			failure,
			"Couldn't load the documents"
		);
		expect(screen.getByText('No documents uploaded yet.')).toBeInTheDocument();
	});
});

describe('DocumentViewer document tiles', () => {
	test('renders images as lazy thumbnails and PDFs as download links', async () => {
		getEntityDocuments.mockResolvedValue(
			page([
				photo({ id: 'img', fileName: 'front.png', mimeType: 'image/png' }),
				photo({ id: 'pdf', fileName: 'policy.pdf', mimeType: 'application/pdf' })
			])
		);
		mount();
		await settle();
		const img = screen.getByRole('img', { name: 'front.png' });
		expect(img).toHaveAttribute('src', '/api/v1/photos/insurance_policy/p1/img/thumbnail');
		expect(img).toHaveAttribute('loading', 'lazy');
		expect(screen.getByText('policy.pdf')).toBeInTheDocument();
		const link = screen.getByRole('link', { name: /download/i });
		expect(link).toHaveAttribute('href', '/api/v1/photos/insurance_policy/p1/pdf/thumbnail');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
		expect(screen.queryByRole('img', { name: 'policy.pdf' })).toBeNull();
	});

	test('treats webp and jpeg as images', async () => {
		getEntityDocuments.mockResolvedValue(
			page([
				photo({ id: 'a', fileName: 'a.webp', mimeType: 'image/webp' }),
				photo({ id: 'b', fileName: 'b.jpg', mimeType: 'image/jpeg' })
			])
		);
		mount();
		await settle();
		expect(screen.getAllByRole('img')).toHaveLength(2);
	});

	test('read-only mode hides upload and delete controls', async () => {
		getEntityDocuments.mockResolvedValue(page([photo()]));
		mount({ readOnly: true });
		await settle();
		expect(screen.getByRole('img', { name: 'card.jpg' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /upload/i })).toBeNull();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});

describe('DocumentViewer uploads', () => {
	test('the Upload button opens the capture dialog configured for documents', async () => {
		mount();
		await settle();
		expect(dialogProps().open).toBe(false);
		expect(dialogProps().title).toBe('Upload Documents');
		expect(dialogProps().acceptedTypes).toEqual([
			'image/jpeg',
			'image/png',
			'image/webp',
			'application/pdf'
		]);
		await fireEvent.click(screen.getByRole('button', { name: /upload/i }));
		expect(dialogProps().open).toBe(true);
		dialogProps().onClose();
		await settle();
		expect(dialogProps().open).toBe(false);
	});

	test('uploads go to the entity endpoint and completed files are appended', async () => {
		const file = new File(['x'], 'new.pdf', { type: 'application/pdf' });
		const uploaded = photo({ id: 'd2', fileName: 'new.pdf', mimeType: 'application/pdf' });
		uploadEntityDocument.mockResolvedValue(uploaded);
		mount({ entityType: 'insurance_claim' });
		await settle();
		await expect(dialogProps().onUpload(file)).resolves.toEqual(uploaded);
		expect(uploadEntityDocument).toHaveBeenCalledWith('insurance_claim', 'p1', file);
		dialogProps().onUploadComplete?.(uploaded);
		await settle();
		expect(screen.queryByText('No documents uploaded yet.')).toBeNull();
		expect(screen.getByText('new.pdf')).toBeInTheDocument();
	});
});

describe('DocumentViewer deletion', () => {
	test('names each delete button after the document it removes', async () => {
		getEntityDocuments.mockResolvedValue(
			page([photo(), photo({ id: 'd2', fileName: 'policy.pdf', mimeType: 'application/pdf' })])
		);
		mount();
		await settle();
		expect(screen.getByRole('button', { name: 'Delete card.jpg' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Delete policy.pdf' })).toBeInTheDocument();
	});

	test('confirming the dialog deletes the document and removes its tile', async () => {
		getEntityDocuments.mockResolvedValue(
			page([photo(), photo({ id: 'd2', fileName: 'other.jpg' })])
		);
		deleteEntityDocument.mockResolvedValue();
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete card.jpg' }));
		await settle();
		const dialog = screen.getByRole('alertdialog');
		expect(within(dialog).getByText('Delete document?')).toBeInTheDocument();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await settle();
		expect(deleteEntityDocument).toHaveBeenCalledWith('insurance_policy', 'p1', 'd1');
		expect(screen.queryByRole('img', { name: 'card.jpg' })).toBeNull();
		expect(screen.getByRole('img', { name: 'other.jpg' })).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('a failed delete notifies and keeps the tile and dialog', async () => {
		const failure = new Error('denied');
		getEntityDocuments.mockResolvedValue(page([photo()]));
		deleteEntityDocument.mockRejectedValue(failure);
		mount();
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete card.jpg' }));
		await settle();
		await fireEvent.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		);
		await settle();
		expect(handleErrorWithNotification).toHaveBeenCalledWith(
			failure,
			"Couldn't delete the document"
		);
		expect(screen.getByRole('img', { name: 'card.jpg' })).toBeInTheDocument();
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});
});
