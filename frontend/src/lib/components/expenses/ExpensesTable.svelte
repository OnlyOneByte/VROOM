<script lang="ts">
	import { Edit, Trash2, SortAsc, SortDesc, DollarSign, Search, Car } from 'lucide-svelte';
	import { settingsStore } from '$lib/stores/settings';
	import { appStore } from '$lib/stores/app';
	import type { Expense, Vehicle, ExpenseCategory } from '$lib/types';
	import { getVolumeUnitLabel, getChargeUnitLabel } from '$lib/utils/units';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import { categoryLabels, getCategoryIcon, getCategoryColor } from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { Button } from '$lib/components/ui/button';
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

	// Delete modal state
	let showDeleteModal = $state(false);
	let expenseToDelete = $state<Expense | null>(null);
	let isDeleting = $state(false);

	// Sorted expenses
	let sortedExpenses = $derived.by(() => {
		const sorted = [...expenses];
		sorted.sort((a, b) => {
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

		return sorted;
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
			const response = await fetch(`/api/expenses/${expenseToDelete.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				await onDelete(expenseToDelete);

				appStore.addNotification({
					type: 'success',
					message: 'Expense deleted successfully'
				});
			} else {
				const result = await response.json();
				appStore.addNotification({
					type: 'error',
					message: result.message || 'Failed to delete expense'
				});
			}
		} catch (error) {
			console.error('Error deleting expense:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Network error. Please try again.'
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
	<div class="rounded-md border">
		<ScrollArea class="h-[{scrollHeight}] w-full" orientation="both">
			<div class="min-w-[800px]">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead class="w-[120px]">
								<button
									onclick={() => handleSort('date')}
									class="flex items-center gap-1 hover:text-gray-900 font-semibold"
								>
									Date
									{#if sortBy === 'date'}
										{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
										<SortIcon class="h-3 w-3" />
									{/if}
								</button>
							</TableHead>
							{#if showVehicleColumn}
								<TableHead class="w-[180px]">Vehicle</TableHead>
							{/if}
							<TableHead class="w-[140px]">Category</TableHead>
							<TableHead class="w-[200px]">
								<button
									onclick={() => handleSort('type')}
									class="flex items-center gap-1 hover:text-gray-900 font-semibold"
								>
									Tags
									{#if sortBy === 'type'}
										{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
										<SortIcon class="h-3 w-3" />
									{/if}
								</button>
							</TableHead>
							<TableHead class="w-[200px]">Description</TableHead>
							<TableHead class="text-right w-[120px]">
								<button
									onclick={() => handleSort('amount')}
									class="flex items-center gap-1 hover:text-gray-900 font-semibold ml-auto"
								>
									Amount
									{#if sortBy === 'amount'}
										{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
										<SortIcon class="h-3 w-3" />
									{/if}
								</button>
							</TableHead>
							<TableHead class="text-right w-[100px]">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each sortedExpenses as expense (expense.id)}
							{@const IconComponent = getCategoryIcon(expense.category)}
							{@const vehicle = getVehicleForExpense(expense)}
							<TableRow class="cursor-pointer hover:bg-gray-50">
								<TableCell class="font-medium">
									{formatDate(new Date(expense.date))}
								</TableCell>
								{#if showVehicleColumn}
									<TableCell>
										<div class="flex items-center gap-2">
											<Car class="h-4 w-4 text-gray-500 flex-shrink-0" />
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
											<span
												class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
											>
												{tag}
											</span>
										{/each}
									</div>
								</TableCell>
								<TableCell>
									<div class="truncate">
										{expense.description || '-'}
									</div>
									{#if expense.mileage || expense.volume || expense.charge}
										<div class="text-xs text-gray-500 mt-1 whitespace-nowrap">
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
									<div class="flex items-center justify-end gap-1">
										<a
											href="/expenses/{expense.id}/edit?returnTo={returnTo}"
											class="btn btn-outline btn-sm p-2"
											title="Edit expense"
											onclick={e => e.stopPropagation()}
										>
											<Edit class="h-4 w-4" />
										</a>
										{#if onDelete}
											<button
												onclick={e => {
													e.stopPropagation();
													confirmDelete(expense);
												}}
												class="btn btn-outline btn-sm p-2 text-red-600 hover:text-red-700 hover:border-red-300"
												title="Delete expense"
											>
												<Trash2 class="h-4 w-4" />
											</button>
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
				<div class="bg-gray-50 rounded-lg p-3">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg {getCategoryColor(expenseToDelete.category)}">
							<IconComponent class="h-4 w-4" />
						</div>
						<div class="flex-1">
							<p class="font-medium text-gray-900">
								{expenseToDelete.description || expenseToDelete.tags?.join(', ') || 'Expense'}
							</p>
							<p class="text-sm text-gray-600">
								{formatDate(new Date(expenseToDelete.date))} • {formatCurrency(
									expenseToDelete.amount
								)}
							</p>
							{#if expenseToDelete.tags && expenseToDelete.tags.length > 0}
								<div class="flex flex-wrap gap-1 mt-1">
									{#each expenseToDelete.tags as tag}
										<span
											class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700"
										>
											{tag}
										</span>
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
					class="bg-red-600 hover:bg-red-700 text-white"
				>
					{#if isDeleting}
						<div class="loading-spinner h-4 w-4 mr-2"></div>
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

<style>
	.loading-spinner {
		border: 2px solid #f3f4f6;
		border-top: 2px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>
