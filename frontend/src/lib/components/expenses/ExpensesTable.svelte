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
		getCategoryBadgeClasses,
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

	// Mirrors the backend sort allowlist (date|amount).
	type SortField = 'date' | 'amount';

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
	// (getVehicleForExpense is called at several render sites for every expense + child).
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

	// Controlled mode trusts the server's order and filtering; re-sorting here would only act on the current page.
	let sortedExpenses = $derived.by(() => {
		let filtered = [...expenses];

		if (categoryFilter && !categoryControlled) {
			filtered = filtered.filter(e => e.category === categoryFilter);
		}

		if (controlled) return filtered;

		filtered.sort((a, b) => compareExpenseRows(a, b, sortBy, sortOrder));

		return filtered;
	});

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

		for (const expense of standalone) {
			rows.push({ type: 'standalone' as const, expense });
		}

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

		// Re-sort grouped rows by the active field so they match the header; the id tiebreak keeps server order for equal keys.
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

	let expandedGroups = new SvelteSet<string>();

	let selectedRowId = $state<string | null>(null);

	/** Insurance-generated expenses cannot be deleted here; the reason is visible text because a title on a disabled control is unreachable. */
	const INSURANCE_DELETE_BLOCKED = 'Delete the insurance policy to remove this expense';

	function isInsuranceLinked(row: GroupRow) {
		return row.tags.includes('insurance');
	}

	function blockedReasonId(groupId: string) {
		return `expense-delete-blocked-${groupId}`;
	}

	function requestGroupDelete(row: GroupRow) {
		if (isInsuranceLinked(row)) {
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
			// Deleting one split sibling would orphan the rest, so route through the group-delete endpoint.
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

	const MOBILE_ROW_SUMMARY_CLASS = 'flex w-full items-start gap-3 px-3 py-3 text-left';

	/** Edit/Delete are drawn at 28px but keep 40px touch targets via a vertical hit-area extension that must not overlap. */
	const MOBILE_ROW_ACTION_CLASS =
		"h-7 px-2 text-xs relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";
	const MOBILE_ROW_ACTIONS_CONTAINER_CLASS = 'flex items-center justify-end gap-2 px-3 pt-1.5 pb-3';
</script>

{#snippet mobileExpenseSummary(expense: Expense, vehicle: Vehicle | undefined)}
	{@const IconComponent = getCategoryIcon(expense.category)}
	<div class="mt-0.5 p-1.5 rounded-lg {getCategoryBadgeClasses(expense.category)} flex-shrink-0">
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
		<div class="flex items-center flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground">
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
					<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

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
	<div class="rounded-md border bg-card">
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

		<div class="divide-y">
			{#if tableRows.length === 0}
				<div class="py-8 text-center">
					<p class="text-muted-foreground text-sm">No expenses match this category filter.</p>
				</div>
			{:else}
				{#each tableRows as row (row.type === 'standalone' ? row.expense.id : row.groupId)}
					{#if row.type === 'standalone'}
						{@const expense = row.expense}
						{@const vehicle = getVehicleForExpense(expense)}
						{@const isSelected = selectedRowId === expense.id}
						<div class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
							{#if canWrite}
								<!-- The summary is the disclosure; actions are its sibling, since a button cannot contain interactive content. -->
								<button
									type="button"
									class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
									aria-expanded={isSelected}
									onclick={() => selectRow(expense.id)}
								>
									{@render mobileExpenseSummary(expense, vehicle)}
								</button>
							{:else}
								<div class={MOBILE_ROW_SUMMARY_CLASS}>
									{@render mobileExpenseSummary(expense, vehicle)}
								</div>
							{/if}
							{#if isSelected && canWrite}
								<div class={MOBILE_ROW_ACTIONS_CONTAINER_CLASS}>
									<Button
										variant="ghost"
										size="sm"
										class={MOBILE_ROW_ACTION_CLASS}
										href={`${resolve(paramRoutes.expenseEdit, { id: expense.id })}?returnTo=${returnTo}`}
									>
										<Pencil class="h-3.5 w-3.5 mr-1" />
										Edit
									</Button>
									{#if onDelete}
										<Button
											variant="ghost"
											size="sm"
											class="{MOBILE_ROW_ACTION_CLASS} text-destructive hover:text-destructive hover:bg-destructive/10"
											onclick={() => confirmDelete(expense)}
										>
											<Trash2 class="h-3.5 w-3.5 mr-1" />
											Delete
										</Button>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						{@const IconComponent = getCategoryIcon(row.category)}
						{@const isSelected = selectedRowId === row.groupId}
						<!-- Group parent row: the per-vehicle portions are always revealable, so this is always a control. -->
						<div class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
							<button
								type="button"
								class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
								aria-expanded={isSelected}
								onclick={() => selectRow(row.groupId)}
							>
								<div
									class="mt-0.5 p-1.5 rounded-lg {getCategoryBadgeClasses(
										row.category
									)} flex-shrink-0"
								>
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
								</div>
							</button>
							{#if isSelected && canWrite}
								{@const blockedId = blockedReasonId(row.groupId)}
								<div class={MOBILE_ROW_ACTIONS_CONTAINER_CLASS}>
									<Button
										variant="ghost"
										size="sm"
										class={MOBILE_ROW_ACTION_CLASS}
										href={`${resolve(paramRoutes.expenseEdit, { id: row.children[0]?.id ?? '' })}?returnTo=${returnTo}`}
									>
										<Pencil class="h-3.5 w-3.5 mr-1" />
										Edit
									</Button>
									{#if onDelete}
										<Button
											variant="ghost"
											size="sm"
											class="{MOBILE_ROW_ACTION_CLASS} {isInsuranceLinked(row)
												? 'cursor-not-allowed aria-disabled:pointer-events-auto'
												: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
											onclick={() => requestGroupDelete(row)}
											aria-disabled={isInsuranceLinked(row) ? true : undefined}
											aria-describedby={isInsuranceLinked(row) ? blockedId : undefined}
											title={isInsuranceLinked(row) ? INSURANCE_DELETE_BLOCKED : 'Delete expense'}
										>
											<Trash2 class="h-3.5 w-3.5 mr-1" />
											Delete
										</Button>
										{#if isInsuranceLinked(row)}
											<span id={blockedId} class="sr-only">{INSURANCE_DELETE_BLOCKED}</span>
										{/if}
									{/if}
								</div>
							{/if}
						</div>
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
	<div class="rounded-md border bg-card overflow-hidden">
		<!-- Height must be an inline style: Tailwind cannot generate arbitrary classes from a runtime value. -->
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
												class="p-1.5 rounded-lg {getCategoryBadgeClasses(
													expense.category
												)} flex-shrink-0"
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
										{#if expense.location}
											<div class="truncate text-xs text-muted-foreground" title={expense.location}>
												📍 {expense.location}
											</div>
										{/if}
									</TableCell>
									<TableCell class="text-right font-semibold whitespace-nowrap">
										{formatCurrency(expense.amount)}
									</TableCell>
									<TableCell class="text-right">
										<!-- Focus variant is required: opacity-0 keeps these controls in the tab order. -->
										<div
											class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
										>
											{#if canWrite}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href={`${resolve(paramRoutes.expenseEdit, { id: expense.id })}?returnTo=${returnTo}`}
													aria-label="Edit expense"
													title="Edit expense"
												>
													<Pencil class="h-4 w-4" />
												</Button>
											{/if}
											{#if onDelete}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
													onclick={() => confirmDelete(expense)}
													aria-label="Delete expense"
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
								<TableRow
									class="group cursor-pointer hover:bg-muted/50"
									onclick={() => toggleGroup(row.groupId)}
								>
									<TableCell class="font-medium text-muted-foreground">
										<div class="flex items-center gap-1.5">
											<!-- Keyboard-accessible toggle; the row click is only a mouse convenience. -->
											<Button
												variant="ghost"
												size="icon-sm"
												class="-ml-1.5 text-muted-foreground"
												aria-label="Split expense portions"
												aria-expanded={isExpanded}
												onclick={e => {
													e.stopPropagation();
													toggleGroup(row.groupId);
												}}
											>
												<ChevronRight
													class="h-4 w-4 transition-transform duration-200 {isExpanded
														? 'rotate-90'
														: ''}"
												/>
											</Button>
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
											<div
												class="p-1.5 rounded-lg {getCategoryBadgeClasses(
													row.category
												)} flex-shrink-0"
											>
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
											class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
										>
											{#if canWrite}
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href={`${resolve(paramRoutes.expenseEdit, { id: row.children[0]?.id ?? '' })}?returnTo=${returnTo}`}
													aria-label="Edit split expense"
													title="Edit split expense"
													onclick={e => e.stopPropagation()}
												>
													<Pencil class="h-4 w-4" />
												</Button>
											{/if}
											{#if onDelete}
												{@const blockedId = blockedReasonId(row.groupId)}
												<!-- aria-disabled rather than disabled keeps the reason tooltip reachable by hover and keyboard. -->
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8 {isInsuranceLinked(row)
														? 'cursor-not-allowed aria-disabled:pointer-events-auto'
														: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
													onclick={e => {
														e.stopPropagation();
														requestGroupDelete(row);
													}}
													aria-label="Delete expense"
													aria-disabled={isInsuranceLinked(row) ? true : undefined}
													aria-describedby={isInsuranceLinked(row) ? blockedId : undefined}
													title={isInsuranceLinked(row)
														? INSURANCE_DELETE_BLOCKED
														: 'Delete expense'}
												>
													<Trash2 class="h-4 w-4" />
												</Button>
												{#if isInsuranceLinked(row)}
													<span id={blockedId} class="sr-only">{INSURANCE_DELETE_BLOCKED}</span>
												{/if}
											{/if}
										</div>
									</TableCell>
								</TableRow>
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
						<div class="p-2 rounded-lg {getCategoryBadgeClasses(expenseToDelete.category)}">
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
