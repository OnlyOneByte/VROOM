<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { appStore } from '$lib/stores/app.svelte';
	import type { Expense, Vehicle } from '$lib/types';
	import PaginationControls from '$lib/components/common/pagination-controls.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import ExpensesTableEmptyState from './expenses-table/ExpensesTableEmptyState.svelte';
	import ExpensesCompactList from './expenses-table/ExpensesCompactList.svelte';
	import ExpensesDesktopTable from './expenses-table/ExpensesDesktopTable.svelte';
	import ExpenseDeleteDialog from './expenses-table/ExpenseDeleteDialog.svelte';
	import {
		INSURANCE_DELETE_BLOCKED,
		deleteExpenseRecord,
		deleteFailureMessage,
		isInsuranceLinked
	} from './expenses-table/expense-table-actions';
	import {
		buildDisplayRows,
		visibleExpenses,
		type GroupRow,
		type SortField
	} from './expenses-table/expense-table-rows';

	interface Props {
		expenses: Expense[];
		vehicles?: Vehicle[];
		showVehicleColumn?: boolean;
		/** When false, Edit links and delete are hidden; defaults to true for the owner's own view. */
		canWrite?: boolean;
		returnTo?: string;
		onDelete?: (_expense: Expense) => Promise<void>;
		emptyTitle?: string;
		emptyDescription?: string;
		emptyActionLabel?: string;
		emptyActionHref?: string;
		scrollHeight?: string;
		onClearFilters?: () => void;
		hasActiveFilters?: boolean;
		totalCount?: number;
		currentOffset?: number;
		pageSize?: number;
		isLoadingPage?: boolean;
		onPageChange?: (_offset: number) => void;
		// Controlled mode: client-side sorting would only reorder the visible page, so the parent owns the sort.
		activeSortBy?: SortField;
		activeSortDir?: 'asc' | 'desc';
		onSortChange?: (_by: SortField, _dir: 'asc' | 'desc') => void;
		// Controlled mode: client-side filtering would only narrow the visible page, so the parent owns the filter.
		activeCategory?: string;
		onCategoryChange?: (_category: string) => void;
	}

	let {
		expenses = [],
		vehicles = [],
		showVehicleColumn = true,
		canWrite = true,
		returnTo = '/expenses',
		onDelete: onDeleteProp,
		emptyTitle = 'No expenses yet',
		emptyDescription = 'Start tracking your vehicle expenses to see insights and analytics.',
		emptyActionLabel = 'Add First Expense',
		emptyActionHref = '/expenses/new',
		scrollHeight = '600px',
		onClearFilters,
		hasActiveFilters = false,
		totalCount,
		currentOffset = 0,
		pageSize = 20,
		isLoadingPage = false,
		onPageChange,
		activeSortBy,
		activeSortDir,
		onSortChange,
		activeCategory,
		onCategoryChange
	}: Props = $props();

	// Suppressing onDelete here hides every delete affordance in one place; Edit links are gated on canWrite per href.
	let onDelete = $derived(canWrite ? onDeleteProp : undefined);

	// O(1) vehicle lookups — avoids an O(n) vehicles.find() per row per render
	// (the vehicle is looked up at several render sites for every expense + child).
	let vehicleMap = $derived(new Map(vehicles.map(v => [v.id, v])));

	// Pagination derived values. Nothing to page through means no bar: an empty list already
	// explains itself with its empty state, and a Previous/Next pair under it is dead chrome.
	let showPagination = $derived(
		totalCount !== undefined && totalCount > 0 && onPageChange !== undefined
	);

	const isMobile = new IsMobile();

	let localSortBy = $state<SortField>('date');
	let localSortOrder = $state<'asc' | 'desc'>('desc');
	const controlled = $derived(onSortChange !== undefined);
	const sortBy = $derived<SortField>(controlled ? (activeSortBy ?? 'date') : localSortBy);
	const sortOrder = $derived<'asc' | 'desc'>(
		controlled ? (activeSortDir ?? 'desc') : localSortOrder
	);

	let localCategoryFilter = $state<string>('');
	const categoryControlled = $derived(onCategoryChange !== undefined);
	const categoryFilter = $derived<string>(
		categoryControlled ? (activeCategory ?? '') : localCategoryFilter
	);

	let showDeleteModal = $state(false);
	let expenseToDelete = $state<Expense | null>(null);
	let isDeleting = $state(false);

	let sortedExpenses = $derived(
		visibleExpenses(expenses, {
			categoryFilter,
			filterByCategory: !categoryControlled,
			sortLocally: !controlled,
			sortBy,
			sortOrder
		})
	);

	let tableRows = $derived(buildDisplayRows(sortedExpenses, vehicleMap, { sortBy, sortOrder }));

	let expandedGroups = new SvelteSet<string>();

	let selectedRowId = $state<string | null>(null);

	function requestGroupDelete(row: GroupRow) {
		if (isInsuranceLinked(row.tags)) {
			appStore.addNotification({ type: 'info', message: INSURANCE_DELETE_BLOCKED });
			return;
		}
		const first = row.children[0];
		if (first) confirmDelete(first);
	}

	function selectRow(id: string) {
		selectedRowId = selectedRowId === id ? null : id;
	}

	function toggleGroup(groupId: string) {
		if (expandedGroups.has(groupId)) {
			expandedGroups.delete(groupId);
		} else {
			expandedGroups.add(groupId);
		}
	}

	function handleSort(newSortBy: SortField) {
		const nextDir: 'asc' | 'desc' =
			sortBy === newSortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
		if (controlled) {
			onSortChange?.(newSortBy, nextDir);
		} else {
			localSortBy = newSortBy;
			localSortOrder = nextDir;
		}
	}

	function handleCategoryChange(value: string) {
		if (categoryControlled) {
			onCategoryChange?.(value);
		} else {
			localCategoryFilter = value;
		}
	}

	function confirmDelete(expense: Expense) {
		expenseToDelete = expense;
		showDeleteModal = true;
	}

	async function deleteExpense() {
		if (!expenseToDelete || !onDelete) return;

		isDeleting = true;

		try {
			await deleteExpenseRecord(expenseToDelete);
			await onDelete(expenseToDelete);

			appStore.addNotification({
				type: 'success',
				message: 'Expense deleted successfully'
			});
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: deleteFailureMessage(error)
			});
		} finally {
			isDeleting = false;
			showDeleteModal = false;
			expenseToDelete = null;
		}
	}
</script>

{#if expenses.length === 0}
	<ExpensesTableEmptyState
		{hasActiveFilters}
		{emptyTitle}
		{emptyDescription}
		{emptyActionLabel}
		{emptyActionHref}
		{onClearFilters}
	/>
{:else if isMobile.current}
	<ExpensesCompactList
		rows={tableRows}
		{vehicleMap}
		{showVehicleColumn}
		{canWrite}
		canDelete={onDelete !== undefined}
		{returnTo}
		{categoryFilter}
		{sortBy}
		{selectedRowId}
		onSelect={selectRow}
		onSort={handleSort}
		onCategoryChange={handleCategoryChange}
		onDeleteExpense={confirmDelete}
		onDeleteGroup={requestGroupDelete}
	/>
{:else}
	<ExpensesDesktopTable
		rows={tableRows}
		{vehicleMap}
		{showVehicleColumn}
		{canWrite}
		canDelete={onDelete !== undefined}
		{returnTo}
		{scrollHeight}
		{categoryFilter}
		{sortBy}
		{expandedGroups}
		onToggleGroup={toggleGroup}
		onSort={handleSort}
		onCategoryChange={handleCategoryChange}
		onDeleteExpense={confirmDelete}
		onDeleteGroup={requestGroupDelete}
	/>
{/if}

{#if showPagination && totalCount !== undefined && onPageChange !== undefined}
	<PaginationControls
		{currentOffset}
		{pageSize}
		{totalCount}
		isLoading={isLoadingPage}
		{onPageChange}
	/>
{/if}

{#if onDelete}
	<ExpenseDeleteDialog
		bind:open={showDeleteModal}
		expense={expenseToDelete}
		{isDeleting}
		onConfirm={deleteExpense}
	/>
{/if}
