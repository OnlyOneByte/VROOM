<script lang="ts">
	import {
		Pencil,
		Trash2,
		ArrowUpDown,
		DollarSign,
		Search,
		Car,
		LoaderCircle,
		Filter
	} from 'lucide-svelte';
	import { settingsStore } from '$lib/stores/settings';
	import { appStore } from '$lib/stores/app';
	import { expenseApi } from '$lib/services/expense-api';
	import type { Expense, Vehicle, ExpenseCategory } from '$lib/types';
	import { getVolumeUnitLabel, getChargeUnitLabel } from '$lib/utils/units';
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

{#if sortedExpenses.length === 0}
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
{:else}
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
												<Filter class="h-3.5 w-3.5 text-primary" />
												{categoryLabels[categoryFilter as ExpenseCategory]}
											{:else}
												Category
											{/if}
										</div>
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="" label="All Categories">All Categories</Select.Item>
										{#each Object.entries(categoryLabels) as [value, label]}
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
						{#each sortedExpenses as expense (expense.id)}
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
									</div>
								</TableCell>
								<TableCell>
									<div class="flex flex-wrap gap-1">
										{#each expense.tags || [] as tag}
											<Badge variant="secondary" class="font-normal">
												{tag}
											</Badge>
										{/each}
									</div>
								</TableCell>
								<TableCell>
									<div class="truncate text-foreground">
										{expense.description || '-'}
									</div>
									{#if expense.mileage || expense.volume || expense.charge}
										<div class="text-xs text-muted-foreground mt-1 whitespace-nowrap">
											{#if expense.mileage}
												{expense.mileage.toLocaleString()} mi
											{/if}
											{#if expense.mileage && (expense.volume || expense.charge)}
												•
											{/if}
											{#if expense.volume}
												{expense.volume}
												{getVolumeUnitLabel(
													$settingsStore.settings?.volumeUnit || 'gallons_us',
													true
												)}
											{/if}
											{#if expense.charge}
												{expense.charge}
												{getChargeUnitLabel($settingsStore.settings?.chargeUnit || 'kwh', true)}
											{/if}
										</div>
									{/if}
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
						{/each}
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
									{#each expenseToDelete.tags as tag}
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
