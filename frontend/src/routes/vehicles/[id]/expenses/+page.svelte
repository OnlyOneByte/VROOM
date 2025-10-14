<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import { 
		ArrowLeft, 
		Plus, 
		Search, 
		Filter, 
		Edit, 
		Trash2, 
		DollarSign, 
		Calendar, 
		Fuel, 
		Wrench, 
		CreditCard, 
		FileText,
		TrendingUp,
		MoreVertical,
		SortAsc,
		SortDesc,
		X
	} from 'lucide-svelte';
	import type { Vehicle, Expense, ExpenseType, ExpenseCategory, ExpenseFilters } from '$lib/types.js';

	const vehicleId = $page.params.id;

	// Component state
	let isLoading = $state(true);
	let vehicle = $state<Vehicle | null>(null);
	let expenses = $state<Expense[]>([]);
	let filteredExpenses = $state<Expense[]>([]);
	let showFilters = $state(false);
	let showDeleteModal = $state(false);
	let expenseToDelete = $state<Expense | null>(null);
	let isDeleting = $state(false);

	// Filters and search
	let searchTerm = $state('');
	let filters = $state<ExpenseFilters>({
		category: undefined,
		type: undefined,
		startDate: undefined,
		endDate: undefined
	});

	// Sorting
	let sortBy = $state<'date' | 'amount' | 'type'>('date');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	// Summary stats
	let summaryStats = $state({
		totalAmount: 0,
		expenseCount: 0,
		categoryTotals: {} as Record<string, number>,
		monthlyAverage: 0,
		lastExpenseDate: null as Date | null
	});

	// Category and type mappings
	const categoryLabels: Record<ExpenseCategory, string> = {
		operating: 'Operating',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		convenience: 'Convenience'
	};

	const typeLabels: Record<ExpenseType, string> = {
		fuel: 'Fuel',
		tolls: 'Tolls',
		parking: 'Parking',
		maintenance: 'Maintenance',
		repairs: 'Repairs',
		tires: 'Tires',
		'oil-change': 'Oil Change',
		insurance: 'Insurance',
		'loan-payment': 'Loan Payment',
		registration: 'Registration',
		inspection: 'Inspection',
		emissions: 'Emissions',
		tickets: 'Tickets',
		modifications: 'Modifications',
		accessories: 'Accessories',
		detailing: 'Detailing',
		other: 'Other'
	};

	onMount(async () => {
		await loadVehicle();
		await loadExpenses();
	});

	async function loadVehicle() {
		try {
			const response = await fetch(`/api/vehicles/${vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				vehicle = await response.json();
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/vehicles');
			}
		} catch (error) {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto('/vehicles');
		}
	}

	async function loadExpenses() {
		try {
			const response = await fetch(`/api/expenses/vehicles/${vehicleId}/expenses`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				expenses = result.data || [];
				applyFiltersAndSort();
				calculateSummaryStats();
			}
		} catch (error) {
			console.error('Error loading expenses:', error);
			appStore.addNotification({
				type: 'error',
				message: 'Error loading expenses'
			});
		} finally {
			isLoading = false;
		}
	}

	function applyFiltersAndSort() {
		let filtered = [...expenses];

		// Apply search filter
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(expense => 
				expense.description?.toLowerCase().includes(term) ||
				expense.type.toLowerCase().includes(term) ||
				expense.category.toLowerCase().includes(term) ||
				expense.amount.toString().includes(term)
			);
		}

		// Apply category filter
		if (filters.category) {
			filtered = filtered.filter(expense => expense.category === filters.category);
		}

		// Apply type filter
		if (filters.type) {
			filtered = filtered.filter(expense => expense.type === filters.type);
		}

		// Apply date range filter
		if (filters.startDate) {
			filtered = filtered.filter(expense => new Date(expense.date) >= filters.startDate!);
		}
		if (filters.endDate) {
			filtered = filtered.filter(expense => new Date(expense.date) <= filters.endDate!);
		}

		// Apply sorting
		filtered.sort((a, b) => {
			let comparison = 0;
			
			switch (sortBy) {
				case 'date':
					comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
					break;
				case 'amount':
					comparison = a.amount - b.amount;
					break;
				case 'type':
					comparison = a.type.localeCompare(b.type);
					break;
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		filteredExpenses = filtered;
	}

	function calculateSummaryStats() {
		const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
		const categoryTotals = expenses.reduce((acc, expense) => {
			acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
			return acc;
		}, {} as Record<string, number>);

		// Calculate monthly average (last 12 months)
		const twelveMonthsAgo = new Date();
		twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
		const recentExpenses = expenses.filter(expense => new Date(expense.date) >= twelveMonthsAgo);
		const monthlyAverage = recentExpenses.length > 0 ? recentExpenses.reduce((sum, expense) => sum + expense.amount, 0) / 12 : 0;

		const lastExpenseDate = expenses.length > 0 
			? new Date(Math.max(...expenses.map(expense => new Date(expense.date).getTime())))
			: null;

		summaryStats = {
			totalAmount,
			expenseCount: expenses.length,
			categoryTotals,
			monthlyAverage,
			lastExpenseDate
		};
	}

	function handleSearch() {
		applyFiltersAndSort();
	}

	function handleFilterChange() {
		applyFiltersAndSort();
	}

	function handleSort(newSortBy: typeof sortBy) {
		if (sortBy === newSortBy) {
			sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = newSortBy;
			sortOrder = 'desc';
		}
		applyFiltersAndSort();
	}

	function clearFilters() {
		searchTerm = '';
		filters = {
			category: undefined,
			type: undefined,
			startDate: undefined,
			endDate: undefined
		};
		applyFiltersAndSort();
	}

	function confirmDelete(expense: Expense) {
		expenseToDelete = expense;
		showDeleteModal = true;
	}

	async function deleteExpense() {
		if (!expenseToDelete) return;

		isDeleting = true;

		try {
			const response = await fetch(`/api/expenses/${expenseToDelete.id}`, {
				method: 'DELETE',
				credentials: 'include'
			});

			if (response.ok) {
				expenses = expenses.filter(e => e.id !== expenseToDelete!.id);
				applyFiltersAndSort();
				calculateSummaryStats();
				
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

	function getVehicleDisplayName(): string {
		if (!vehicle) return '';
		return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	}

	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function formatDate(date: Date): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		}).format(date);
	}

	function getCategoryIcon(category: ExpenseCategory) {
		switch (category) {
			case 'operating': return Fuel;
			case 'maintenance': return Wrench;
			case 'financial': return CreditCard;
			default: return DollarSign;
		}
	}

	function getCategoryColor(category: ExpenseCategory): string {
		switch (category) {
			case 'operating': return 'text-blue-600 bg-blue-100';
			case 'maintenance': return 'text-orange-600 bg-orange-100';
			case 'financial': return 'text-green-600 bg-green-100';
			case 'regulatory': return 'text-purple-600 bg-purple-100';
			case 'enhancement': return 'text-pink-600 bg-pink-100';
			case 'convenience': return 'text-gray-600 bg-gray-100';
			default: return 'text-gray-600 bg-gray-100';
		}
	}

	// Reactive updates
	$effect(() => {
		handleSearch();
	});

	$effect(() => {
		handleFilterChange();
	});
</script>

<svelte:head>
	<title>Expenses - {getVehicleDisplayName()} - VROOM Car Tracker</title>
	<meta name="description" content="View and manage vehicle expenses" />
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else if vehicle}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<button 
					onclick={() => goto(`/vehicles/${vehicleId}`)}
					class="btn btn-secondary p-2"
				>
					<ArrowLeft class="h-4 w-4" />
				</button>
				<div>
					<h1 class="text-2xl font-bold text-gray-900">Expenses</h1>
					<p class="text-gray-600">{getVehicleDisplayName()}</p>
				</div>
			</div>

			<a 
				href="/vehicles/{vehicleId}/expenses/new"
				class="btn btn-primary inline-flex items-center gap-2"
			>
				<Plus class="h-4 w-4" />
				Add Expense
			</a>
		</div>

		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Expenses</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(summaryStats.totalAmount)}</p>
					</div>
					<DollarSign class="h-8 w-8 text-primary-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Count</p>
						<p class="text-2xl font-bold text-gray-900">{summaryStats.expenseCount}</p>
					</div>
					<FileText class="h-8 w-8 text-blue-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Monthly Average</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(summaryStats.monthlyAverage)}</p>
					</div>
					<TrendingUp class="h-8 w-8 text-green-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Last Expense</p>
						<p class="text-lg font-bold text-gray-900">
							{summaryStats.lastExpenseDate ? formatDate(summaryStats.lastExpenseDate) : 'None'}
						</p>
					</div>
					<Calendar class="h-8 w-8 text-orange-600" />
				</div>
			</div>
		</div>

		<!-- Category Summary -->
		{#if Object.keys(summaryStats.categoryTotals).length > 0}
			<div class="card">
				<h3 class="text-lg font-semibold text-gray-900 mb-4">Expenses by Category</h3>
				<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
					{#each Object.entries(summaryStats.categoryTotals) as [category, amount]}
						{@const IconComponent = getCategoryIcon(category as ExpenseCategory)}
						<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
							<div class="flex items-center gap-2">
								<div class="p-2 rounded-lg {getCategoryColor(category as ExpenseCategory)}">
									<IconComponent class="h-4 w-4" />
								</div>
								<span class="text-sm font-medium text-gray-700">{categoryLabels[category as ExpenseCategory]}</span>
							</div>
							<span class="text-sm font-bold text-gray-900">{formatCurrency(amount)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Search and Filters -->
		<div class="card space-y-4">
			<!-- Search Bar -->
			<div class="flex gap-2">
				<div class="flex-1 relative">
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<Search class="h-5 w-5 text-gray-400" />
					</div>
					<input
						type="text"
						bind:value={searchTerm}
						placeholder="Search expenses..."
						class="input pl-10 w-full"
					/>
				</div>
				<button
					onclick={() => showFilters = !showFilters}
					class="btn btn-outline inline-flex items-center gap-2"
				>
					<Filter class="h-4 w-4" />
					Filters
				</button>
			</div>

			<!-- Filter Panel -->
			{#if showFilters}
				<div class="border-t border-gray-200 pt-4 space-y-4">
					<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
						<!-- Category Filter -->
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Category</label>
							<select bind:value={filters.category} class="input">
								<option value={undefined}>All Categories</option>
								{#each Object.entries(categoryLabels) as [value, label]}
									<option value={value}>{label}</option>
								{/each}
							</select>
						</div>

						<!-- Type Filter -->
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Type</label>
							<select bind:value={filters.type} class="input">
								<option value={undefined}>All Types</option>
								{#each Object.entries(typeLabels) as [value, label]}
									<option value={value}>{label}</option>
								{/each}
							</select>
						</div>

						<!-- Start Date -->
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
							<input
								type="date"
								bind:value={filters.startDate}
								class="input"
							/>
						</div>

						<!-- End Date -->
						<div>
							<label class="block text-sm font-medium text-gray-700 mb-2">End Date</label>
							<input
								type="date"
								bind:value={filters.endDate}
								class="input"
							/>
						</div>
					</div>

					<div class="flex justify-end">
						<button
							onclick={clearFilters}
							class="btn btn-outline inline-flex items-center gap-2"
						>
							<X class="h-4 w-4" />
							Clear Filters
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Expense List -->
		<div class="card">
			<div class="flex items-center justify-between mb-4">
				<h3 class="text-lg font-semibold text-gray-900">
					Expenses ({filteredExpenses.length})
				</h3>
				
				<!-- Sort Controls -->
				<div class="flex gap-2">
					<button
						onclick={() => handleSort('date')}
						class="btn btn-outline btn-sm inline-flex items-center gap-1"
					>
						Date
						{#if sortBy === 'date'}
							{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
							<SortIcon class="h-3 w-3" />
						{/if}
					</button>
					<button
						onclick={() => handleSort('amount')}
						class="btn btn-outline btn-sm inline-flex items-center gap-1"
					>
						Amount
						{#if sortBy === 'amount'}
							{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
							<SortIcon class="h-3 w-3" />
						{/if}
					</button>
					<button
						onclick={() => handleSort('type')}
						class="btn btn-outline btn-sm inline-flex items-center gap-1"
					>
						Type
						{#if sortBy === 'type'}
							{@const SortIcon = sortOrder === 'asc' ? SortAsc : SortDesc}
							<SortIcon class="h-3 w-3" />
						{/if}
					</button>
				</div>
			</div>

			{#if filteredExpenses.length === 0}
				<div class="text-center py-12">
					{#if expenses.length === 0}
						<DollarSign class="h-12 w-12 text-gray-400 mx-auto mb-4" />
						<h3 class="text-lg font-medium text-gray-900 mb-2">No expenses yet</h3>
						<p class="text-gray-600 mb-4">Start tracking expenses for this vehicle</p>
						<a 
							href="/vehicles/{vehicleId}/expenses/new"
							class="btn btn-primary inline-flex items-center gap-2"
						>
							<Plus class="h-4 w-4" />
							Add First Expense
						</a>
					{:else}
						<Search class="h-12 w-12 text-gray-400 mx-auto mb-4" />
						<h3 class="text-lg font-medium text-gray-900 mb-2">No matching expenses</h3>
						<p class="text-gray-600 mb-4">Try adjusting your search or filters</p>
						<button 
							onclick={clearFilters}
							class="btn btn-outline"
						>
							Clear Filters
						</button>
					{/if}
				</div>
			{:else}
				<div class="space-y-3">
					{#each filteredExpenses as expense}
						{@const IconComponent = getCategoryIcon(expense.category)}
						<div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
							<div class="flex items-center gap-4 flex-1">
								<div class="p-2 rounded-lg {getCategoryColor(expense.category)}">
									<IconComponent class="h-5 w-5" />
								</div>
								
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-1">
										<h4 class="font-medium text-gray-900 truncate">
											{expense.description || typeLabels[expense.type]}
										</h4>
										<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-800">
											{typeLabels[expense.type]}
										</span>
									</div>
									<div class="flex items-center gap-4 text-sm text-gray-600">
										<span>{formatDate(new Date(expense.date))}</span>
										{#if expense.mileage}
											<span>{expense.mileage.toLocaleString()} mi</span>
										{/if}
										{#if expense.gallons}
											<span>{expense.gallons} gal</span>
										{/if}
									</div>
								</div>
							</div>

							<div class="flex items-center gap-3">
								<span class="text-lg font-bold text-gray-900">
									{formatCurrency(expense.amount)}
								</span>
								
								<div class="flex items-center gap-1">
									<a
										href="/vehicles/{vehicleId}/expenses/{expense.id}/edit"
										class="btn btn-outline btn-sm p-2"
										title="Edit expense"
									>
										<Edit class="h-4 w-4" />
									</a>
									<button
										onclick={() => confirmDelete(expense)}
										class="btn btn-outline btn-sm p-2 text-red-600 hover:text-red-700 hover:border-red-300"
										title="Delete expense"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- Delete Confirmation Modal -->
	{#if showDeleteModal && expenseToDelete}
		{@const IconComponent = getCategoryIcon(expenseToDelete.category)}
		<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
			<div class="bg-white rounded-lg max-w-md w-full p-6">
				<h3 class="text-lg font-semibold text-gray-900 mb-4">Delete Expense</h3>
				<p class="text-gray-600 mb-6">
					Are you sure you want to delete this expense? This action cannot be undone.
				</p>
				
				<div class="bg-gray-50 rounded-lg p-3 mb-6">
					<div class="flex items-center gap-3">
						<div class="p-2 rounded-lg {getCategoryColor(expenseToDelete.category)}">
							<IconComponent class="h-4 w-4" />
						</div>
						<div>
							<p class="font-medium text-gray-900">
								{expenseToDelete.description || typeLabels[expenseToDelete.type]}
							</p>
							<p class="text-sm text-gray-600">
								{formatDate(new Date(expenseToDelete.date))} • {formatCurrency(expenseToDelete.amount)}
							</p>
						</div>
					</div>
				</div>

				<div class="flex gap-3">
					<button
						onclick={() => { showDeleteModal = false; expenseToDelete = null; }}
						class="btn btn-outline flex-1"
						disabled={isDeleting}
					>
						Cancel
					</button>
					<button
						onclick={deleteExpense}
						class="btn bg-red-600 hover:bg-red-700 text-white flex-1 flex items-center justify-center gap-2"
						disabled={isDeleting}
					>
						{#if isDeleting}
							<div class="loading-spinner h-4 w-4"></div>
							Deleting...
						{:else}
							<Trash2 class="h-4 w-4" />
							Delete
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	.input {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 0.5rem;
		box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
		color: #9ca3af;
		outline: none;
		font-size: 1rem;
	}
	
	.input:focus {
		outline: none;
		border-color: #2563eb;
		box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.5);
	}

	.loading-spinner {
		border: 2px solid #f3f4f6;
		border-top: 2px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style>