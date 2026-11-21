import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const { photoSection } = vi.hoisted(() => ({
	photoSection: vi.fn<(props: { entityType: string; entityId: string }) => void>()
}));

vi.mock('#lib/components/expenses/form/ExpensePhotoSection.svelte', () => ({
	default: (_anchor: unknown, props: { entityType: string; entityId: string }) => {
		photoSection({ entityType: props.entityType, entityId: props.entityId });
	}
}));

const InsuranceManagedView = (await import('../InsuranceManagedView.svelte')).default;

interface ViewProps {
	category: string;
	amount: string;
	date: string;
	description: string;
	tags: string[];
	policyId: string | null;
	photoEntityId: string | null;
	isDeleting: boolean;
	onBack: () => void;
	onEditTerm: () => void;
	onForceDelete: () => void;
}

function props(overrides: Partial<ViewProps> = {}): ViewProps {
	return {
		category: 'financial',
		amount: '612.5',
		date: '2026-03-15',
		description: '',
		tags: [],
		policyId: 'pol-1',
		photoEntityId: null,
		isDeleting: false,
		onBack: vi.fn(),
		onEditTerm: vi.fn(),
		onForceDelete: vi.fn(),
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe('InsuranceManagedView', () => {
	test('shows the managed-by-insurance notice with category, amount and date', () => {
		render(InsuranceManagedView, { props: props() });

		expect(screen.getByRole('heading', { name: 'Insurance Expense' })).toBeInTheDocument();
		expect(screen.getByText('This expense is managed by an insurance policy')).toBeInTheDocument();
		expect(screen.getByText('Financial')).toBeInTheDocument();
		expect(screen.getByText('$612.50')).toBeInTheDocument();
		expect(screen.getByText('Mar 15, 2026')).toBeInTheDocument();
	});

	test('an unknown category is shown as its raw value', () => {
		render(InsuranceManagedView, { props: props({ category: 'warranty' }) });
		expect(screen.getByText('warranty')).toBeInTheDocument();
	});

	test('an unparseable amount is shown as zero', () => {
		render(InsuranceManagedView, { props: props({ amount: '' }) });
		expect(screen.getByText('$0.00')).toBeInTheDocument();
	});

	test('Edit Insurance Term is offered only when there is a policy', async () => {
		const onEditTerm = vi.fn();
		const { unmount } = render(InsuranceManagedView, { props: props({ onEditTerm }) });

		await fireEvent.click(screen.getByRole('button', { name: 'Edit Insurance Term' }));
		expect(onEditTerm).toHaveBeenCalledTimes(1);
		unmount();

		render(InsuranceManagedView, { props: props({ policyId: null }) });
		expect(screen.queryByRole('button', { name: 'Edit Insurance Term' })).toBeNull();
	});

	test('shows description and tags only when present', () => {
		const { unmount } = render(InsuranceManagedView, { props: props() });
		expect(screen.queryByText('Description')).toBeNull();
		expect(screen.queryByText('Tags')).toBeNull();
		unmount();

		render(InsuranceManagedView, {
			props: props({ description: 'Semi-annual premium', tags: ['insurance', 'auto'] })
		});
		expect(screen.getByText('Description')).toBeInTheDocument();
		expect(screen.getByText('Semi-annual premium')).toBeInTheDocument();
		expect(screen.getByText('Tags')).toBeInTheDocument();
		expect(screen.getByText('insurance')).toBeInTheDocument();
		expect(screen.getByText('auto')).toBeInTheDocument();
	});

	test('renders the photo section for the expense only when it has an entity id', () => {
		const { unmount } = render(InsuranceManagedView, { props: props() });
		expect(photoSection).not.toHaveBeenCalled();
		unmount();

		render(InsuranceManagedView, { props: props({ photoEntityId: 'exp-9' }) });
		expect(photoSection).toHaveBeenCalledWith({ entityType: 'expense', entityId: 'exp-9' });
	});

	test('both back controls call onBack', async () => {
		const onBack = vi.fn();
		render(InsuranceManagedView, { props: props({ onBack }) });

		await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Back to Expenses' }));

		expect(onBack).toHaveBeenCalledTimes(2);
	});

	test('Force Delete calls onForceDelete and is disabled while deleting', async () => {
		const onForceDelete = vi.fn();
		const { unmount } = render(InsuranceManagedView, { props: props({ onForceDelete }) });

		await fireEvent.click(screen.getByRole('button', { name: 'Force Delete' }));
		expect(onForceDelete).toHaveBeenCalledTimes(1);
		unmount();

		render(InsuranceManagedView, { props: props({ isDeleting: true }) });
		expect(screen.getByRole('button', { name: 'Force Delete' })).toBeDisabled();
	});
});
