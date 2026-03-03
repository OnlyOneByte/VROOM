<script lang="ts">
	import {
		Pencil,
		Trash2,
		ArrowUpDown,
		DollarSign,
		Search,
		Car,
		LoaderCircle,
		ListFilter
	} from 'lucide-svelte';
	import { appStore } from '$lib/stores/app';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseCategory } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
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
	import SplitExpenseBadge from './SplitExpenseBadge.svelte';
	import { ChevronRight } from 'lucide-svelte';
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
		category: string;
		date: string;
		description: string | undefined;
		tags: string[];
		vehicleNames: string[];
		children: Expense[];
	}

	type DisplayRow = ExpenseRow | GroupRow;

	interface Props {
		expenses: Expense[];
		vehicles?: Vehicle[];
		showVehicleColumn?: boolean;
		returnTo?: string;
		onDelete?: (_expense: Expense) => Promise<void>;
		emptyTitle?: string;
		emptyDescription?: string;
		emptyActionLabel?: string;
		emptyActionHref?: string;
		scrollHeight?: string;
		onClearFilters?: () => void;
		hasActiveFilters?: boolean;
	}

	let {
		expenses = [],
		vehicles = [],
		showVehicleColumn = true,
		returnTo = '/expenses',
		onDelete,
		emptyTitle = 'No expenses yet',
		emptyDescription = 'Start tracking your vehicle expenses to see insights and analytics.',
		emptyActionLabel = 'Add First Expense',
		emptyActionHref = '/expenses/new',
		scrollHeight = '600px',
		onClearFilters,
		hasActiveFilters = false
	}: Props = $props();

	const isMobile = new IsMobile();

	// Sorting state
	let sortBy = $state<'date' | 'amount' | 'type'>('date');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Category filter state
	let categoryFilter = $state<string>('');

	// Delete modal state
	let showDeleteModal = $state(false);
	let expenseToDelete = $state<Expense | null>(null);
	let isDeleting = $state(false);

	// Filtered and sorted expenses
	let sortedExpenses = $derived.by(() => {
		let filtered = [...expenses];

		// Apply category filter
		if (categoryFilter) {
			filtered = filtered.filter(e => e.category === categoryFilter);
		}

		filtered.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'date':
					comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
					break;
				case 'amount':
					comparison = a.amount - b.amount;
					break;
				case 'type': {
					// Sort by first tag
					const aTag = a.tags?.[0] || '';
					const bTag = b.tags?.[0] || '';
					comparison = aTag.localeCompare(bTag);
					break;
				}
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		return filtered;
	});

	// Group expenses: children with same expenseGroupId become collapsible groups
	let tableRows = $derived.by((): DisplayRow[] => {
		const grouped = new Map<string, Expense[]>();
		const standalone: Expense[] = [];

		for (const expense of sortedExpenses) {
			if (expense.expenseGroupId) {
				const existing = grouped.get(expense.expenseGroupId);
				if (existing) {
					existing.push(expense);
				} else {
					grouped.set(expense.expenseGroupId, [expense]);
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
			const vehicleNameSet = new Set<string>();
			for (const child of children) {
				const v = vehicles.find(vh => vh.id === child.vehicleId);
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

		// Sort combined rows by date
		rows.sort((a, b) => {
			const dateA = a.type === 'standalone' ? a.expense.date : a.date;
			const dateB = b.type === 'standalone' ? b.expense.date : b.date;
			const comparison = new Date(dateA).getTime() - new Date(dateB).getTime();
			return sortOrder === 'asc' ? comparison : -comparison;
		});

		return rows;
	});

	// Expand state for groups
	let expandedGroups = $state(new Set<string>());

	// Mobile: selected row for showing actions
	let selectedRowId = $state<string | null>(null);

	function selectRow(id: string) {
		selectedRowId = selectedRowId === id ? null : id;
	}

	function toggleGroup(groupId: string) {
		const next = new Set(expandedGroups);
		if (next.has(groupId)) {
			next.delete(groupId);
		} else {
			next.add(groupId);
		}
		expandedGroups = next;
	}

	function handleSort(newSortBy: typeof sortBy) {
		if (sortBy === newSortBy) {
			sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = newSortBy;
			sortOrder = 'desc';
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
			await expenseApi.deleteExpense(expenseToDelete.id);
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
		return vehicles.find(v => v.id === expense.vehicleId);
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
					categoryFilter = v;
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
										{expense.tags?.join(', ') ||
											categoryLabels[expense.category as ExpenseCategory]}
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
									<span>·</span>
									<span>{categoryLabels[expense.category as ExpenseCategory]}</span>
								</div>
								{#if expense.tags && expense.tags.length > 0}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each expense.tags as tag (tag)}
											<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0"
												>{tag}</Badge
											>
										{/each}
									</div>
								{/if}
								{#if isSelected}
									<div class="flex items-center justify-end gap-1 mt-2">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											href="/expenses/{expense.id}/edit?returnTo={returnTo}"
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
										{row.tags?.join(', ') || categoryLabels[row.category as ExpenseCategory]}
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
									<span>·</span>
									<span>{categoryLabels[row.category as ExpenseCategory]}</span>
								</div>
								{#if isSelected}
									<div class="flex items-center justify-end gap-1 mt-2">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											href="/expenses/{row.children[0]?.id}/edit?returnTo={returnTo}"
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
	<div class="rounded-md border bg-card">
		<ScrollArea class="h-[{scrollHeight}] w-full" orientation="both">
			<div class="min-w-[800px]">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead class="w-[120px]">
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
								<TableHead class="w-[180px]">Vehicle</TableHead>
							{/if}
							<TableHead class="w-[140px]">
								<Select.Root
									type="single"
									value={categoryFilter}
									onValueChange={v => {
										categoryFilter = v;
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
							<TableHead class="w-[200px]">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => handleSort('type')}
									class="h-8 px-2 -ml-2 hover:bg-muted"
								>
									Tags
									{#if sortBy === 'type'}
										<ArrowUpDown class="ml-1 h-3.5 w-3.5" />
									{/if}
								</Button>
							</TableHead>
							<TableHead class="w-[200px]">Description</TableHead>
							<TableHead class="text-right w-[120px]">
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
							<TableHead class="text-right w-[100px]">Actions</TableHead>
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
													class="p-1.5 rounded-lg {getCategoryColor(
														expense.category
													)} flex-shrink-0"
												>
													<IconComponent class="h-4 w-4" />
												</div>
												<span class="whitespace-nowrap"
													>{categoryLabels[expense.category as ExpenseCategory]}</span
												>
											</div>
										</TableCell>
										<TableCell>
											<div class="flex flex-wrap gap-1">
												{#each expense.tags || [] as tag (tag)}
													<Badge variant="secondary" class="font-normal">{tag}</Badge>
												{/each}
											</div>
										</TableCell>
										<TableCell>
											<div class="truncate text-foreground">{expense.description || '-'}</div>
										</TableCell>
										<TableCell class="text-right font-semibold whitespace-nowrap">
											{formatCurrency(expense.amount)}
										</TableCell>
										<TableCell class="text-right">
											<div
												class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
											>
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href="/expenses/{expense.id}/edit?returnTo={returnTo}"
													title="Edit expense"
													onclick={e => e.stopPropagation()}
												>
													<Pencil class="h-4 w-4" />
												</Button>
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
												<div
													class="p-1.5 rounded-lg {getCategoryColor(row.category)} flex-shrink-0"
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
										<TableCell>
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
												<Button
													variant="ghost"
													size="icon"
													class="h-8 w-8"
													href="/expenses/{row.children[0]?.id}/edit?returnTo={returnTo}"
													title="Edit split expense"
													onclick={e => e.stopPropagation()}
												>
													<Pencil class="h-4 w-4" />
												</Button>
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
												<TableCell
													class="text-right text-sm text-muted-foreground whitespace-nowrap"
												>
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
			</div>
		</ScrollArea>
	</div>
{/if}

<!-- Delete Confirmation AlertDialog -->
{#if onDelete}
	<AlertDialog bind:open={showDeleteModal}>
		<AlertDialogContent>
			<AlertDialogHeader>
				<AlertDialogTitle>Delete Expense</AlertDialogTitle>
				<AlertDialogDescription>
					Are you sure you want to delete this expense? This action cannot be undone.
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
