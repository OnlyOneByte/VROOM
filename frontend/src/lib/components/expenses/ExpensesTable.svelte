<script lang="ts">
	import { resolve } from '$app/paths';
	import { paramRoutes } from '$lib/routes';
	import {
		Pencil,
		Trash2,
		ArrowUpDown,
		DollarSign,
		Search,
		Car,
		LoaderCircle,
		ListFilter,
		ChevronRight
	} from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { appStore } from '$lib/stores/app.svelte';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseCategory } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import {
		categoryLabels,
		getCategoryIcon,
		getCategoryColor,
		compareExpenseRows,
		type SortableRow
	} from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		AlertDialog,
		AlertDialogAction,
		AlertDialogCancel,
		AlertDialogContent,
		AlertDialogDescription,
		AlertDialogFooter,
		AlertDialogHeader,
		AlertDialogTitle
	} from '$lib/components/ui/alert-dialog';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import {
		Empty,
		EmptyContent,
		EmptyDescription,
		EmptyHeader,
		EmptyMedia,
		EmptyTitle
	} from '$lib/components/ui/empty';
	import * as Select from '$lib/components/ui/select';
	import SplitExpenseBadge from './split/SplitExpenseBadge.svelte';
	import RecurringExpenseBadge from './RecurringExpenseBadge.svelte';
	import PaginationControls from '$lib/components/common/pagination-controls.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';

	// Types for grouped display
	interface ExpenseRow {
		type: 'standalone';
		expense: Expense;
	}

	interface GroupRow {
		type: 'group';
		groupId: string;
		totalAmount: number;
		category: ExpenseCategory;
		date: string;
		description: string | undefined;
		tags: string[];
		vehicleNames: string[];
		children: Expense[];
	}

	type DisplayRow = ExpenseRow | GroupRow;

	// Columns the table can sort by. Mirrors the backend allowlist (date|amount);
	// the old client-only first-tag "type" sort had no server equivalent and was
	// already dead (tableRows re-sorted by date regardless), so it's dropped.
	type SortField = 'date' | 'amount';

	interface Props {
		expenses: Expense[];
		vehicles?: Vehicle[];
		showVehicleColumn?: boolean;
		/** vehicle-sharing T12b-3b: expense edit/delete are WRITES (owner or accepted editor). A shared
		 *  VIEWER sees the table read-only. When false, the Edit links are hidden AND `onDelete` is
		 *  suppressed (so every existing `{#if onDelete}` delete gate hides too). Default true so every
		 *  existing call site (global expenses page, owner vehicle tab) is unchanged. */
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
		// Server-side sort (controlled mode). When onSortChange is provided, the
		// sortable headers report intent to the parent (which re-fetches the page
		// server-sorted) instead of sorting the current page client-side — the latter
		// only reorders the visible slice, so "sort by amount" would surface the
		// biggest expense ON THIS PAGE, not overall. activeSortBy/Dir drive the header
		// indicator. With no onSortChange the table falls back to local client sort.
		activeSortBy?: SortField;
		activeSortDir?: 'asc' | 'desc';
		onSortChange?: (_by: SortField, _dir: 'asc' | 'desc') => void;
		// Server-side category filter (controlled mode), same opt-in shape as sort.
		// When onCategoryChange is provided the category Select reports to the parent
		// (which re-fetches the page server-filtered across ALL rows) instead of
		// filtering the current page client-side — the latter only narrows the visible
		// 20-row slice, so picking a category hides matching rows on other pages.
		// activeCategory drives the trigger label. With no handler the table falls back
		// to the local client-side category filter (used by the vehicle-detail tab).
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

	// vehicle-sharing T12b-3b: a VIEWER (canWrite=false) gets NO delete — suppress onDelete so every
	// `{#if onDelete}` delete-affordance gate (mobile + desktop, standalone + split) hides in one place.
	// The Edit links are gated separately on `canWrite` at each href site.
	let onDelete = $derived(canWrite ? onDeleteProp : undefined);

	// O(1) vehicle lookups — avoids an O(n) vehicles.find() per row per render
	// (getVehicleForExpense is called at several render sites for every expense + child).
	let vehicleMap = $derived(new Map(vehicles.map(v => [v.id, v])));

	// Pagination derived values
	let showPagination = $derived(totalCount !== undefined && onPageChange !== undefined);

	const isMobile = new IsMobile();

	// Sorting. In controlled mode (onSortChange provided) the parent owns the sort
	// and re-fetches the page server-sorted; the header indicator reads the active*
	// props. In uncontrolled mode the table sorts the rows it was given locally.
	let localSortBy = $state<SortField>('date');
	let localSortOrder = $state<'asc' | 'desc'>('desc');
	const controlled = $derived(onSortChange !== undefined);
	const sortBy = $derived<SortField>(controlled ? (activeSortBy ?? 'date') : localSortBy);
	const sortOrder = $derived<'asc' | 'desc'>(
		controlled ? (activeSortDir ?? 'desc') : localSortOrder
	);

	// Category filter. In controlled mode (onCategoryChange provided) the parent owns
	// it and re-fetches the page server-filtered; the Select reads activeCategory. In
	// uncontrolled mode the table filters the rows it was given locally.
	let localCategoryFilter = $state<string>('');
	const categoryControlled = $derived(onCategoryChange !== undefined);
	const categoryFilter = $derived<string>(
		categoryControlled ? (activeCategory ?? '') : localCategoryFilter
	);

	// Delete modal state
	let showDeleteModal = $state(false);
	let expenseToDelete = $state<Expense | null>(null);
	let isDeleting = $state(false);

	// Filtered and sorted expenses.
	// In controlled mode the server already sorted/filtered across the whole dataset,
	// so we MUST preserve the received rows+order (re-doing it here would only act on
	// the page slice and undo the point of going server-side). In uncontrolled mode we
	// sort + category-filter the given rows locally.
	let sortedExpenses = $derived.by(() => {
		let filtered = [...expenses];

		// Apply category filter locally ONLY when the parent isn't doing it server-side
		// (controlled mode already returns rows pre-filtered to the chosen category).
		if (categoryFilter && !categoryControlled) {
			filtered = filtered.filter(e => e.category === categoryFilter);
		}

		if (controlled) return filtered;

		// Sort via the shared comparator, which carries a stable id tiebreaker in the
		// server's direction (bug #4) so equal date/amount rows don't reshuffle.
		filtered.sort((a, b) => compareExpenseRows(a, b, sortBy, sortOrder));

		return filtered;
	});

	// Group expenses: children with same groupId become collapsible groups
	let tableRows = $derived.by((): DisplayRow[] => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used within $derived computation, not mutated reactively
		const grouped = new Map<string, Expense[]>();
		const standalone: Expense[] = [];

		for (const expense of sortedExpenses) {
			if (expense.groupId) {
				const existing = grouped.get(expense.groupId);
				if (existing) {
					existing.push(expense);
				} else {
					grouped.set(expense.groupId, [expense]);
				}
			} else {
				standalone.push(expense);
			}
		}

		const rows: DisplayRow[] = [];

		// Add standalone expenses
		for (const expense of standalone) {
			rows.push({ type: 'standalone' as const, expense });
		}

		// Add group rows
		for (const [groupId, children] of grouped) {
			const first = children[0];
			if (!first) continue;
			const totalAmount = Math.round(children.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Set used within $derived computation, not mutated reactively
			const vehicleNameSet = new Set<string>();
			for (const child of children) {
				const v = vehicleMap.get(child.vehicleId);
				if (v) vehicleNameSet.add(getVehicleDisplayName(v));
			}
			rows.push({
				type: 'group' as const,
				groupId,
				totalAmount,
				category: first.category,
				date: first.date,
				description: first.description,
				tags: first.tags || [],
				vehicleNames: [...vehicleNameSet],
				children
			});
		}

		// Re-order the combined rows by the ACTIVE sort field (not always date — the
		// old hardcoded date sort here is what made the Amount header a no-op). Group
		// rows use their representative value: total amount, or the group's date, and
		// the first child's id as their stable key. This runs in both modes so a
		// collapsed split group sits in the right place among standalone rows; in
		// controlled mode it re-imposes the server's chosen order onto the grouped view
		// (consistent, since both use the same field+direction). Via compareExpenseRows
		// so equal date/amount rows break ties by id in the server's direction (bug #4)
		// — grouping concatenates standalone-then-group, which would otherwise reshuffle
		// same-key rows out of the server's order.
		rows.sort((a, b) => {
			const rowA: SortableRow =
				a.type === 'standalone'
					? a.expense
					: { id: a.children[0]?.id ?? a.groupId, date: a.date, amount: a.totalAmount };
			const rowB: SortableRow =
				b.type === 'standalone'
					? b.expense
					: { id: b.children[0]?.id ?? b.groupId, date: b.date, amount: b.totalAmount };
			return compareExpenseRows(rowA, rowB, sortBy, sortOrder);
		});

		return rows;
	});

	// Expand state for groups
	let expandedGroups = new SvelteSet<string>();

	// Mobile: selected row for showing actions
	let selectedRowId = $state<string | null>(null);

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
		// Toggle direction when re-selecting the active column, else default to desc.
		const nextDir: 'asc' | 'desc' =
			sortBy === newSortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
		if (controlled) {
			// Parent re-fetches the page server-sorted across the WHOLE dataset.
			onSortChange?.(newSortBy, nextDir);
		} else {
			localSortBy = newSortBy;
			localSortOrder = nextDir;
		}
	}

	function handleCategoryChange(value: string) {
		if (categoryControlled) {
			// Parent re-fetches the page server-filtered across the WHOLE dataset.
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
			// A split sibling carries a groupId; deleting it by its own id only removes
			// that one row and orphans the rest of the split (the remaining rows no
			// longer sum to the group total). Route it through the group-delete
			// endpoint so every vehicle's portion goes — matching what the dialog says.
			if (expenseToDelete.groupId) {
				await expenseApi.deleteSplitExpense(expenseToDelete.groupId);
			} else {
				await expenseApi.deleteExpense(expenseToDelete.id);
			}
			await onDelete(expenseToDelete);

			appStore.addNotification({
				type: 'success',
				message: 'Expense deleted successfully'
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to delete expense';
			appStore.addNotification({
				type: 'error',
				message
			});
		} finally {
			isDeleting = false;
			showDeleteModal = false;
			expenseToDelete = null;
		}
	}

	function getVehicleForExpense(expense: Expense): Vehicle | undefined {
		return vehicleMap.get(expense.vehicleId);
	}
</script>

{#if expenses.length === 0}
	<Empty>
		<EmptyHeader>
			<EmptyMedia>
				{#if hasActiveFilters}
					<Search class="h-12 w-12 text-muted-foreground" />
				{:else}
					<DollarSign class="h-12 w-12 text-muted-foreground" />
				{/if}
			</EmptyMedia>
			<EmptyTitle>
				{hasActiveFilters ? 'No matching expenses' : emptyTitle}
			</EmptyTitle>
			<EmptyDescription>
				{hasActiveFilters
					? "Try adjusting your search or filters to find what you're looking for."
					: emptyDescription}
			</EmptyDescription>
		</EmptyHeader>
		<EmptyContent>
			{#if hasActiveFilters && onClearFilters}
				<Button onclick={onClearFilters} variant="outline">Clear Filters</Button>
			{:else}
				<Button href={emptyActionHref} class="inline-flex items-center gap-2">
					{emptyActionLabel}
				</Button>
			{/if}
		</EmptyContent>
	</Empty>
{:else if isMobile.current}
	<!-- Mobile: compact card-style rows -->
	<div class="rounded-md border bg-card">
		<!-- Mobile sort/filter toolbar -->
		<div class="flex items-center gap-2 border-b px-3 py-2">
			<Select.Root
				type="single"
				value={categoryFilter}
				onValueChange={v => {
					handleCategoryChange(v);
				}}
			>
				<Select.Trigger
					class="h-8 px-2 border-none shadow-none hover:bg-muted font-medium text-muted-foreground text-xs"
				>
					<div class="flex items-center gap-1">
						{#if categoryFilter}
							<ListFilter class="h-3 w-3 text-primary" />
							{categoryLabels[categoryFilter as ExpenseCategory]}
						{:else}
							<ListFilter class="h-3 w-3" />
							Category
						{/if}
					</div>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="All Categories">All Categories</Select.Item>
					{#each Object.entries(categoryLabels) as [value, label] (value)}
						<Select.Item {value} {label}>{label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>

			<div class="ml-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => handleSort('date')}
					class="h-8 px-2 text-xs"
				>
					Date
					{#if sortBy === 'date'}
						<ArrowUpDown class="ml-1 h-3 w-3" />
					{/if}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => handleSort('amount')}
					class="h-8 px-2 text-xs"
				>
					Amount
					{#if sortBy === 'amount'}
						<ArrowUpDown class="ml-1 h-3 w-3" />
					{/if}
				</Button>
			</div>
		</div>

		<!-- Mobile rows -->
		<div class="divide-y">
			{#if tableRows.length === 0}
				<div class="py-8 text-center">
					<p class="text-muted-foreground text-sm">No expenses match this category filter.</p>
				</div>
			{:else}
				{#each tableRows as row (row.type === 'standalone' ? row.expense.id : row.groupId)}
					{#if row.type === 'standalone'}
						{@const expense = row.expense}
						{@const IconComponent = getCategoryIcon(expense.category)}
						{@const vehicle = getVehicleForExpense(expense)}
						{@const isSelected = selectedRowId === expense.id}
						<button
							type="button"
							class="flex items-start gap-3 px-3 py-3 w-full text-left transition-colors {isSelected
								? 'bg-muted/50'
								: ''}"
							onclick={() => selectRow(expense.id)}
						>
							<div
								class="mt-0.5 p-1.5 rounded-lg {getCategoryColor(expense.category)} flex-shrink-0"
							>
								<IconComponent class="h-4 w-4" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-start justify-between gap-2">
									<p class="text-sm font-medium text-foreground truncate">
										{categoryLabels[expense.category as ExpenseCategory]}
									</p>
									<span class="text-sm font-semibold text-foreground whitespace-nowrap">
										{formatCurrency(expense.amount)}
									</span>
								</div>
								<div
									class="flex items-center flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground"
								>
									<span>{formatDate(new Date(expense.date))}</span>
									{#if showVehicleColumn && vehicle}
										<span>·</span>
										<span class="truncate">{getVehicleDisplayName(vehicle)}</span>
									{/if}
								</div>
								{#if expense.sourceType === 'reminder'}
									<div class="mt-1.5">
										<RecurringExpenseBadge />
									</div>
								{/if}
								{#if expense.tags && expense.tags.length > 0}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each expense.tags as tag (tag)}
											<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0"
												>{tag}</Badge
											>
										{/each}
									</div>
								{/if}
								{#if isSelected && canWrite}
									<div class="flex items-center justify-end gap-1 mt-2">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											href={`${resolve(paramRoutes.expenseEdit, { id: expense.id })}?returnTo=${returnTo}`}
											onclick={e => e.stopPropagation()}
										>
											<Pencil class="h-3.5 w-3.5 mr-1" />
											Edit
										</Button>
										{#if onDelete}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
												onclick={e => {
													e.stopPropagation();
													confirmDelete(expense);
												}}
											>
												<Trash2 class="h-3.5 w-3.5 mr-1" />
												Delete
											</Button>
										{/if}
									</div>
								{/if}
							</div>
						</button>
					{:else}
						{@const IconComponent = getCategoryIcon(row.category)}
						{@const isSelected = selectedRowId === row.groupId}
						<!-- Group parent row (mobile) -->
						<div
							class="flex items-start gap-3 px-3 py-3 cursor-pointer transition-colors {isSelected
								? 'bg-muted/50'
								: ''}"
							role="button"
							tabindex="0"
							onclick={() => selectRow(row.groupId)}
							onkeydown={e => {
								if (e.key === 'Enter' || e.key === ' ') selectRow(row.groupId);
							}}
						>
							<div class="mt-0.5 p-1.5 rounded-lg {getCategoryColor(row.category)} flex-shrink-0">
								<IconComponent class="h-4 w-4" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center justify-between gap-2">
									<p class="text-sm font-medium text-foreground truncate">
										{categoryLabels[row.category as ExpenseCategory]}
									</p>
									<span
										class="text-sm font-semibold text-foreground whitespace-nowrap flex-shrink-0"
									>
										{formatCurrency(row.totalAmount)}
									</span>
								</div>
								<div
									class="flex items-center flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground"
								>
									<SplitExpenseBadge />
									<span>·</span>
									<span>{formatDate(new Date(row.date))}</span>
									{#if showVehicleColumn && row.vehicleNames.length > 0}
										<span>·</span>
										<span class="truncate">{row.vehicleNames.join(', ')}</span>
									{/if}
								</div>
								{#if row.tags && row.tags.length > 0}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each row.tags as tag (tag)}
											<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0"
												>{tag}</Badge
											>
										{/each}
									</div>
								{/if}
								{#if isSelected && canWrite}
									<div class="flex items-center justify-end gap-1 mt-2">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											href={`${resolve(paramRoutes.expenseEdit, { id: row.children[0]?.id ?? '' })}?returnTo=${returnTo}`}
											onclick={e => e.stopPropagation()}
										>
											<Pencil class="h-3.5 w-3.5 mr-1" />
											Edit
										</Button>
										{#if onDelete}
											{@const isInsuranceLinked = row.tags.includes('insurance')}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs {isInsuranceLinked
													? 'text-muted-foreground/40 cursor-not-allowed'
													: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
												onclick={e => {
													e.stopPropagation();
													if (!isInsuranceLinked && row.children[0]) {
														confirmDelete(row.children[0]);
													}
												}}
												disabled={isInsuranceLinked}
												title={isInsuranceLinked
													? 'Delete the insurance policy to remove this expense'
													: 'Delete expense'}
											>
												<Trash2 class="h-3.5 w-3.5 mr-1" />
												Delete
											</Button>
										{/if}
									</div>
								{/if}
							</div>
						</div>
						<!-- Children visible when selected (mobile) -->
						{#if isSelected}
							{#each row.children as child (child.id)}
								{@const childVehicle = getVehicleForExpense(child)}
								<div class="flex items-center gap-3 pl-10 pr-3 py-2 bg-muted/30">
									<div class="flex-1 min-w-0">
										<div class="flex items-center justify-between gap-2">
											<span class="text-xs text-muted-foreground truncate">
												{#if showVehicleColumn && childVehicle}
													{getVehicleDisplayName(childVehicle)}
												{:else}
													{formatDate(new Date(child.date))}
												{/if}
											</span>
											<span class="text-sm text-muted-foreground whitespace-nowrap">
												{formatCurrency(child.amount)}
											</span>
										</div>
									</div>
								</div>
							{/each}
						{/if}
					{/if}
				{/each}
			{/if}
		</div>
	</div>
{:else}
	<!-- Desktop: full table -->
	<div class="rounded-md border bg-card overflow-hidden">
		<!-- height MUST be an inline style, not `h-[{scrollHeight}]`: Tailwind only generates
		     arbitrary-value classes it can see as STATIC literals at build time, so a runtime-
		     interpolated `h-[600px]` produces no CSS rule (confirmed C14 via DOM probe) — the cap
		     + internal scroll never engage and a many-row vehicle grows unbounded. Inline style is
		     the ChartCard idiom for a dynamic height. -->
		<ScrollArea class="w-full" style="height: {scrollHeight}">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="whitespace-nowrap">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => handleSort('date')}
								class="h-8 px-2 -ml-2 hover:bg-muted"
							>
								Date
								{#if sortBy === 'date'}
									<ArrowUpDown class="ml-1 h-3.5 w-3.5" />
								{/if}
							</Button>
						</TableHead>
						{#if showVehicleColumn}
							<TableHead class="whitespace-nowrap">Vehicle</TableHead>
						{/if}
						<TableHead class="whitespace-nowrap">
							<Select.Root
								type="single"
								value={categoryFilter}
								onValueChange={v => {
									handleCategoryChange(v);
								}}
							>
								<Select.Trigger
									class="h-8 px-2 -ml-2 border-none shadow-none hover:bg-muted font-medium text-muted-foreground"
								>
									<div class="flex items-center gap-1">
										{#if categoryFilter}
											<ListFilter class="h-3.5 w-3.5 text-primary" />
											{categoryLabels[categoryFilter as ExpenseCategory]}
										{:else}
											Category
										{/if}
									</div>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="" label="All Categories">All Categories</Select.Item>
									{#each Object.entries(categoryLabels) as [value, label] (value)}
										<Select.Item {value} {label}>{label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</TableHead>
						<TableHead>Tags</TableHead>
						<TableHead class="w-full min-w-[100px]">Description</TableHead>
						<TableHead class="text-right whitespace-nowrap">
							<Button
								variant="ghost"
								size="sm"
								onclick={() => handleSort('amount')}
								class="h-8 px-2 -mr-2 ml-auto hover:bg-muted"
							>
								Amount
								{#if sortBy === 'amount'}
									<ArrowUpDown class="ml-1 h-3.5 w-3.5" />
								{/if}
							</Button>
						</TableHead>
						<TableHead class="text-right whitespace-nowrap">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#if tableRows.length === 0}
						<TableRow>
							<TableCell colspan={showVehicleColumn ? 7 : 6} class="h-24 text-center">
								<p class="text-muted-foreground">No expenses match this category filter.</p>
							</TableCell>
						</TableRow>
					{:else}
						{#each tableRows as row (row.type === 'standalone' ? row.expense.id : row.groupId)}
							{#if row.type === 'standalone'}
								{@const expense = row.expense}
								{@const IconComponent = getCategoryIcon(expense.category)}
								{@const vehicle = getVehicleForExpense(expense)}
								<TableRow class="group">
									<TableCell class="font-medium text-muted-foreground">
										{formatDate(new Date(expense.date))}
									</TableCell>
									{#if showVehicleColumn}
										<TableCell>
											<div class="flex items-center gap-2">
												<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
												<span class="truncate">
													{vehicle ? getVehicleDisplayName(vehicle) : 'Unknown'}
												</span>
											</div>
										</TableCell>
									{/if}
									<TableCell>
										<div class="flex items-center gap-2">
											<div
												class="p-1.5 rounded-lg {getCategoryColor(expense.category)} flex-shrink-0"
											>
												<IconComponent class="h-4 w-4" />
											</div>
											<span class="whitespace-nowrap"
												>{categoryLabels[expense.category as ExpenseCategory]}</span
											>
											{#if expense.sourceType === 'reminder'}
												<RecurringExpenseBadge />
											{/if}
										</div>
									</TableCell>
									<TableCell>
										<div class="flex flex-wrap gap-1">
											{#each expense.tags || [] as tag (tag)}
												<Badge variant="secondary" class="font-normal">{tag}</Badge>
											{/each}
										</div>
									</TableCell>
									<TableCell class="max-w-[200px]">
										<div class="truncate text-foreground">{expense.description || '-'}</div>
									</TableCell>
									<TableCell class="text-right font-semibold whitespace-nowrap">
										{formatCurrency(expense.amount)}
									</TableCell>
									<TableCell class="text-right">
										<div
											class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
										>
											{#if canWrite}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href={`${resolve(paramRoutes.expenseEdit, { id: expense.id })}?returnTo=${returnTo}`}
													title="Edit expense"
													onclick={e => e.stopPropagation()}
												>
													<Pencil class="h-4 w-4" />
												</Button>
											{/if}
											{#if onDelete}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
													onclick={e => {
														e.stopPropagation();
														confirmDelete(expense);
													}}
													title="Delete expense"
												>
													<Trash2 class="h-4 w-4" />
												</Button>
											{/if}
										</div>
									</TableCell>
								</TableRow>
							{:else}
								{@const IconComponent = getCategoryIcon(row.category)}
								{@const isExpanded = expandedGroups.has(row.groupId)}
								<!-- Group parent row -->
								<TableRow
									class="group cursor-pointer hover:bg-muted/50"
									onclick={() => toggleGroup(row.groupId)}
								>
									<TableCell class="font-medium text-muted-foreground">
										<div class="flex items-center gap-1.5">
											<ChevronRight
												class="h-4 w-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 {isExpanded
													? 'rotate-90'
													: ''}"
											/>
											{formatDate(new Date(row.date))}
										</div>
									</TableCell>
									{#if showVehicleColumn}
										<TableCell>
											<div class="flex items-center gap-2">
												<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
												<span class="truncate text-sm">
													{row.vehicleNames.join(', ')}
												</span>
											</div>
										</TableCell>
									{/if}
									<TableCell>
										<div class="flex items-center gap-2">
											<div class="p-1.5 rounded-lg {getCategoryColor(row.category)} flex-shrink-0">
												<IconComponent class="h-4 w-4" />
											</div>
											<span class="whitespace-nowrap"
												>{categoryLabels[row.category as ExpenseCategory]}</span
											>
										</div>
									</TableCell>
									<TableCell>
										<div class="flex flex-wrap gap-1">
											{#each row.tags as tag (tag)}
												<Badge variant="secondary" class="font-normal">{tag}</Badge>
											{/each}
										</div>
									</TableCell>
									<TableCell class="max-w-[200px]">
										<div class="truncate text-foreground">{row.description || '-'}</div>
									</TableCell>
									<TableCell class="text-right font-semibold whitespace-nowrap">
										<div class="flex items-center justify-end gap-1.5">
											{formatCurrency(row.totalAmount)}
											<SplitExpenseBadge />
										</div>
									</TableCell>
									<TableCell class="text-right">
										<div
											class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
										>
											{#if canWrite}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href={`${resolve(paramRoutes.expenseEdit, { id: row.children[0]?.id ?? '' })}?returnTo=${returnTo}`}
													title="Edit split expense"
													onclick={e => e.stopPropagation()}
												>
													<Pencil class="h-4 w-4" />
												</Button>
											{/if}
											{#if onDelete}
												{@const isInsuranceLinked = row.tags.includes('insurance')}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8 {isInsuranceLinked
														? 'text-muted-foreground/40 cursor-not-allowed'
														: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
													onclick={e => {
														e.stopPropagation();
														if (!isInsuranceLinked && row.children[0]) {
															confirmDelete(row.children[0]);
														}
													}}
													disabled={isInsuranceLinked}
													title={isInsuranceLinked
														? 'Delete the insurance policy to remove this expense'
														: 'Delete expense'}
												>
													<Trash2 class="h-4 w-4" />
												</Button>
											{/if}
										</div>
									</TableCell>
								</TableRow>
								<!-- Expanded child rows -->
								{#if isExpanded}
									{#each row.children as child (child.id)}
										{@const childVehicle = getVehicleForExpense(child)}
										<TableRow class="bg-muted/30">
											<TableCell class="pl-8 text-xs text-muted-foreground">
												{formatDate(new Date(child.date))}
											</TableCell>
											{#if showVehicleColumn}
												<TableCell>
													<div class="flex items-center gap-2 pl-4">
														<Car class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
														<span class="truncate text-sm text-muted-foreground">
															{childVehicle ? getVehicleDisplayName(childVehicle) : 'Unknown'}
														</span>
													</div>
												</TableCell>
											{/if}
											<TableCell></TableCell>
											<TableCell></TableCell>
											<TableCell></TableCell>
											<TableCell class="text-right text-sm text-muted-foreground whitespace-nowrap">
												{formatCurrency(child.amount)}
											</TableCell>
											<TableCell></TableCell>
										</TableRow>
									{/each}
								{/if}
							{/if}
						{/each}
					{/if}
				</TableBody>
			</Table>
		</ScrollArea>
	</div>
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

<!-- Delete Confirmation AlertDialog -->
{#if onDelete}
	<AlertDialog bind:open={showDeleteModal}>
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>Delete Expense</AlertDialogTitle>
				<AlertDialogDescription>
					{#if expenseToDelete?.groupId}
						This is a split expense shared across multiple vehicles. Deleting it removes the entire
						split — every vehicle's portion — not just one. This action cannot be undone.
					{:else}
						Are you sure you want to delete this expense? This action cannot be undone.
					{/if}
				</AlertDialogDescription>
			</AlertDialogHeader>

			{#if expenseToDelete}
				{@const IconComponent = getCategoryIcon(expenseToDelete.category)}
				<div class="bg-muted rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg {getCategoryColor(expenseToDelete.category)}">
							<IconComponent class="h-4 w-4" />
						</div>
						<div class="flex-1">
							<p class="font-medium text-foreground">
								{expenseToDelete.description || expenseToDelete.tags?.join(', ') || 'Expense'}
							</p>
							<p class="text-sm text-muted-foreground">
								{formatDate(new Date(expenseToDelete.date))} • {formatCurrency(
									expenseToDelete.amount
								)}
							</p>
							{#if expenseToDelete.tags && expenseToDelete.tags.length > 0}
								<div class="flex flex-wrap gap-1 mt-2">
									{#each expenseToDelete.tags as tag (tag)}
										<Badge variant="secondary" class="font-normal">
											{tag}
										</Badge>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<AlertDialogFooter>
				<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
				<AlertDialogAction
					onclick={deleteExpense}
					disabled={isDeleting}
					class="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
				>
					{#if isDeleting}
						<LoaderCircle class="h-4 w-4 animate-spin mr-2" />
						Deleting...
					{:else}
						<Trash2 class="h-4 w-4 mr-2" />
						Delete
					{/if}
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
{/if}
