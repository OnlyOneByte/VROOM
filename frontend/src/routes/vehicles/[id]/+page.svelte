<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { appStore } from '$lib/stores/app.js';
	import {
		ArrowLeft,
		Car,
		Edit,
		Plus,
		DollarSign,
		Gauge,
		TrendingUp,
		CreditCard,
		Fuel,
		Wrench,
		Search,
		Filter,
		Trash2,
		SortAsc,
		SortDesc,
		X,
		FileText,
		Settings
	} from 'lucide-svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
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
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
	import type { Vehicle, Expense, ExpenseFilters } from '$lib/types.js';

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
	let activeTab = $state('overview');

	// Filters and search
	let searchTerm = $state('');
	let filters = $state<ExpenseFilters>({});

	// Sorting
	let sortBy = $state<'date' | 'amount' | 'type'>('date');
	let sortOrder = $state<'asc' | 'desc'>('desc');

	let vehicleStats = $state({
		totalExpenses: 0,
		recentExpenses: 0,
		expenseCount: 0,
		avgMpg: 0,
		monthlyAverage: 0,
		lastExpenseDate: null as Date | null,
		expensesByCategory: {} as Record<string, number>
	});

	// Category mappings
	const categoryLabels: Record<string, string> = {
		fuel: 'Fuel',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		misc: 'Misc Operating Costs'
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
				const result = await response.json();
				vehicle = result.data || result;
			} else {
				appStore.addNotification({
					type: 'error',
					message: 'Vehicle not found'
				});
				goto('/vehicles');
			}
		} catch {
			appStore.addNotification({
				type: 'error',
				message: 'Error loading vehicle'
			});
			goto('/vehicles');
		}
	}

	async function loadExpenses() {
		try {
			const response = await fetch(`/api/expenses?vehicleId=${vehicleId}`, {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				expenses = result.data || result || [];
				applyFiltersAndSort();
				calculateStats();
			}
		} catch (error) {
			console.error('Error loading expenses:', error);
		} finally {
			isLoading = false;
		}
	}

	function applyFiltersAndSort() {
		let filtered = [...expenses];

		// Apply search filter
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase();
			filtered = filtered.filter(
				expense =>
					expense.description?.toLowerCase().includes(term) ||
					expense.tags?.some(tag => tag.toLowerCase().includes(term)) ||
					expense.category.toLowerCase().includes(term) ||
					expense.amount.toString().includes(term)
			);
		}

		// Apply category filter
		if (filters.category) {
			filtered = filtered.filter(expense => expense.category === filters.category);
		}

		// Apply tags filter
		if (filters.tags && filters.tags.length > 0) {
			filtered = filtered.filter(expense => filters.tags!.some(tag => expense.tags.includes(tag)));
		}

		// Apply date range filter
		if (filters.startDate) {
			filtered = filtered.filter(expense => new Date(expense.date) >= new Date(filters.startDate!));
		}
		if (filters.endDate) {
			filtered = filtered.filter(expense => new Date(expense.date) <= new Date(filters.endDate!));
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
					comparison = a.category.localeCompare(b.category);
					break;
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		filteredExpenses = filtered;
	}

	function calculateStats() {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const recentExpenses = expenses.filter(e => new Date(e.date) > thirtyDaysAgo);
		const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
		const recentAmount = recentExpenses.reduce((sum, e) => sum + e.amount, 0);

		// Calculate expenses by category
		const expensesByCategory = expenses.reduce(
			(acc, expense) => {
				acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
				return acc;
			},
			{} as Record<string, number>
		);

		// Calculate monthly average (last 12 months)
		const twelveMonthsAgo = new Date();
		twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
		const recentExpensesYear = expenses.filter(
			expense => new Date(expense.date) >= twelveMonthsAgo
		);
		const monthlyAverage =
			recentExpensesYear.length > 0
				? recentExpensesYear.reduce((sum, expense) => sum + expense.amount, 0) / 12
				: 0;

		// Calculate fuel efficiency
		const fuelExpenses = expenses.filter(e => e.category === 'fuel' && e.gallons && e.mileage);
		let avgMpg = 0;
		if (fuelExpenses.length > 1) {
			const mpgValues = [];
			for (let i = 1; i < fuelExpenses.length; i++) {
				const current = fuelExpenses[i];
				const previous = fuelExpenses[i - 1];
				if (current?.mileage && previous?.mileage && current?.gallons) {
					const miles = current.mileage - previous.mileage;
					const mpg = miles / current.gallons;
					if (mpg > 0 && mpg < 100) {
						mpgValues.push(mpg);
					}
				}
			}
			avgMpg =
				mpgValues.length > 0 ? mpgValues.reduce((sum, mpg) => sum + mpg, 0) / mpgValues.length : 0;
		}

		vehicleStats = {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			expenseCount: expenses.length,
			avgMpg: Math.round(avgMpg * 10) / 10,
			monthlyAverage,
			lastExpenseDate:
				expenses.length > 0
					? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime())))
					: null,
			expensesByCategory
		};
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
		filters = {};
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
				calculateStats();

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

	// Reactive updates
	$effect(() => {
		applyFiltersAndSort();
	});

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

	function getCategoryIcon(category: string) {
		switch (category) {
			case 'operating':
				return Fuel;
			case 'maintenance':
				return Wrench;
			case 'financial':
				return CreditCard;
			default:
				return DollarSign;
		}
	}

	function getCategoryColor(category: string): string {
		switch (category) {
			case 'operating':
				return 'text-blue-600 bg-blue-100';
			case 'maintenance':
				return 'text-orange-600 bg-orange-100';
			case 'financial':
				return 'text-green-600 bg-green-100';
			case 'regulatory':
				return 'text-purple-600 bg-purple-100';
			case 'enhancement':
				return 'text-pink-600 bg-pink-100';
			case 'convenience':
				return 'text-gray-600 bg-gray-100';
			default:
				return 'text-gray-600 bg-gray-100';
		}
	}

	function formatCategoryName(category: string): string {
		return category.charAt(0).toUpperCase() + category.slice(1);
	}
</script>

<svelte:head>
	<title>{getVehicleDisplayName()} - VROOM Car Tracker</title>
	<meta name="description" content="Vehicle details and expense tracking" />
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div class="loading-spinner h-8 w-8"></div>
	</div>
{:else if vehicle}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button
				onclick={() => goto('/vehicles')}
				class="btn btn-secondary p-2 transition-all duration-200 hover:bg-primary-100 hover:border-primary-300 hover:scale-110"
			>
				<ArrowLeft class="h-4 w-4 transition-colors duration-200 hover:text-primary-700" />
			</button>
			<div class="flex items-center gap-2">
				<div>
					<h1 class="text-2xl font-bold text-gray-900">{getVehicleDisplayName()}</h1>
					<p class="text-gray-600">{vehicle.year} {vehicle.make} {vehicle.model}</p>
				</div>
				<a
					href="/vehicles/{vehicleId}/edit"
					class="btn btn-secondary p-2 transition-all duration-200 hover:bg-primary-100 hover:border-primary-300 hover:scale-110"
					title="Edit vehicle"
				>
					<Settings class="h-5 w-5 transition-colors duration-200 hover:text-primary-700" />
				</a>
			</div>
		</div>

		<!-- Tabs Navigation -->
		<Tabs bind:value={activeTab} class="space-y-6">
			<TabsList class="grid w-full grid-cols-4">
				<TabsTrigger value="overview">Overview</TabsTrigger>
				<TabsTrigger value="expenses">Expenses</TabsTrigger>
				<TabsTrigger value="maintenance">Reminders</TabsTrigger>
				<TabsTrigger value="loan">Finance</TabsTrigger>
			</TabsList>

			<!-- Overview Tab -->
			<TabsContent value="overview" class="space-y-6">
				<!-- Vehicle Overview Cards -->
				<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
					<div class="card-compact">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-gray-600">Total Expenses</p>
								<p class="text-2xl font-bold text-gray-900">
									{formatCurrency(vehicleStats.totalExpenses)}
								</p>
							</div>
							<DollarSign class="h-8 w-8 text-primary-600" />
						</div>
					</div>

					<div class="card-compact">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-gray-600">Last 30 Days</p>
								<p class="text-2xl font-bold text-gray-900">
									{formatCurrency(vehicleStats.recentExpenses)}
								</p>
							</div>
							<TrendingUp class="h-8 w-8 text-green-600" />
						</div>
					</div>

					<div class="card-compact">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-gray-600">Monthly Average</p>
								<p class="text-2xl font-bold text-gray-900">
									{formatCurrency(vehicleStats.monthlyAverage)}
								</p>
							</div>
							<FileText class="h-8 w-8 text-blue-600" />
						</div>
					</div>

					<div class="card-compact">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium text-gray-600">
									{vehicleStats.avgMpg > 0 ? 'Avg MPG' : 'Last Expense'}
								</p>
								<p class="text-2xl font-bold text-gray-900">
									{#if vehicleStats.avgMpg > 0}
										{vehicleStats.avgMpg}
									{:else if vehicleStats.lastExpenseDate}
										{formatDate(vehicleStats.lastExpenseDate)}
									{:else}
										None
									{/if}
								</p>
							</div>
							<Gauge class="h-8 w-8 text-orange-600" />
						</div>
					</div>
				</div>

				<!-- Expenses by Category -->
				{#if Object.keys(vehicleStats.expensesByCategory).length > 0}
					<div class="card">
						<h3 class="text-lg font-semibold text-gray-900 mb-4">Expenses by Category</h3>
						<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
							{#each Object.entries(vehicleStats.expensesByCategory) as [category, amount]}
								{@const IconComponent = getCategoryIcon(category)}
								<div class="flex flex-col items-center p-3 bg-gray-50 rounded-lg">
									<div class="p-2 rounded-lg {getCategoryColor(category)} mb-2">
										<IconComponent class="h-4 w-4" />
									</div>
									<span class="text-xs font-medium text-gray-700 mb-1"
										>{formatCategoryName(category)}</span
									>
									<span class="text-sm font-bold text-gray-900">{formatCurrency(amount)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Basic Information -->
				<div class="card">
					<div class="flex items-center gap-2 mb-4">
						<Car class="h-5 w-5 text-primary-600" />
						<h2 class="text-lg font-semibold text-gray-900">Vehicle Information</h2>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						<div>
							<p class="text-sm text-gray-600">Make & Model</p>
							<p class="font-medium text-gray-900">{vehicle.make} {vehicle.model}</p>
						</div>

						<div>
							<p class="text-sm text-gray-600">Year</p>
							<p class="font-medium text-gray-900">{vehicle.year}</p>
						</div>

						{#if vehicle.licensePlate}
							<div>
								<p class="text-sm text-gray-600">License Plate</p>
								<p class="font-medium text-gray-900 font-mono">{vehicle.licensePlate}</p>
							</div>
						{/if}

						{#if vehicle.initialMileage}
							<div>
								<p class="text-sm text-gray-600">Initial Mileage</p>
								<p class="font-medium text-gray-900">
									{vehicle.initialMileage.toLocaleString()} mi
								</p>
							</div>
						{/if}

						{#if vehicle.purchaseDate}
							<div>
								<p class="text-sm text-gray-600">Purchase Date</p>
								<p class="font-medium text-gray-900">
									{formatDate(new Date(vehicle.purchaseDate))}
								</p>
							</div>
						{/if}

						{#if vehicle.purchasePrice}
							<div>
								<p class="text-sm text-gray-600">Purchase Price</p>
								<p class="font-medium text-gray-900">{formatCurrency(vehicle.purchasePrice)}</p>
							</div>
						{/if}
					</div>
				</div>
			</TabsContent>

			<!-- Expenses Tab -->
			<TabsContent value="expenses" class="space-y-6">
				<!-- Search and Filters -->
				<div class="card space-y-4">
					<!-- Search Bar -->
					<div class="flex gap-2">
						<div class="flex-1 relative">
							<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
								<Search class="h-5 w-5 text-gray-400" />
							</div>
							<Input
								type="text"
								bind:value={searchTerm}
								placeholder="Search expenses..."
								class="pl-10 w-full"
							/>
						</div>
						<button
							onclick={() => (showFilters = !showFilters)}
							class="btn btn-outline inline-flex items-center gap-2"
						>
							<Filter class="h-4 w-4" />
							Filters
						</button>
					</div>

					<!-- Filter Panel -->
					{#if showFilters}
						<div class="border-t border-gray-200 pt-4 space-y-4">
							<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								<!-- Category Filter -->
								<div>
									<label for="category-filter" class="block text-sm font-medium text-gray-700 mb-2"
										>Category</label
									>
									<select id="category-filter" bind:value={filters.category} class="form-input">
										<option value={undefined}>All Categories</option>
										{#each Object.entries(categoryLabels) as [value, label]}
											<option {value}>{label}</option>
										{/each}
									</select>
								</div>

								<!-- Start Date -->
								<div>
									<label
										for="start-date-filter"
										class="block text-sm font-medium text-gray-700 mb-2">Start Date</label
									>
									<DatePicker
										id="start-date-filter"
										bind:value={filters.startDate}
										placeholder="Select start date"
									/>
								</div>

								<!-- End Date -->
								<div>
									<label for="end-date-filter" class="block text-sm font-medium text-gray-700 mb-2"
										>End Date</label
									>
									<DatePicker
										id="end-date-filter"
										bind:value={filters.endDate}
										placeholder="Select end date"
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
						<h2 class="text-lg font-semibold text-gray-900">
							All Expenses ({filteredExpenses.length})
						</h2>

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
						</div>
					</div>

					{#if filteredExpenses.length === 0}
						<div class="text-center py-8">
							{#if expenses.length === 0}
								<DollarSign class="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<h3 class="text-lg font-medium text-gray-900 mb-2">No expenses yet</h3>
								<p class="text-gray-600">Start tracking expenses for this vehicle</p>
							{:else}
								<Search class="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<h3 class="text-lg font-medium text-gray-900 mb-2">No matching expenses</h3>
								<p class="text-gray-600 mb-4">Try adjusting your search or filters</p>
								<button onclick={clearFilters} class="btn btn-outline"> Clear Filters </button>
							{/if}
						</div>
					{:else}
						<div class="space-y-3">
							{#each filteredExpenses as expense}
								{@const IconComponent = getCategoryIcon(expense.category)}
								<div
									class="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
								>
									<div class="flex items-center gap-4 flex-1">
										<div class="p-2 rounded-lg {getCategoryColor(expense.category)}">
											<IconComponent class="h-5 w-5" />
										</div>

										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-2 mb-1">
												<h4 class="font-medium text-gray-900 truncate">
													{expense.description || categoryLabels[expense.category] || 'Expense'}
												</h4>
												{#if expense.tags && expense.tags.length > 0}
													<span
														class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-800"
													>
														{expense.tags[0]}
													</span>
												{/if}
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
												href="/expenses/{expense.id}/edit?returnTo=/vehicles/{vehicleId}"
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
			</TabsContent>

			<!-- Reminders Tab -->
			<TabsContent value="maintenance" class="space-y-6">
				<div class="card">
					<div class="flex items-center gap-2 mb-4">
						<Wrench class="h-5 w-5 text-primary-600" />
						<h2 class="text-lg font-semibold text-gray-900">Reminders</h2>
					</div>
					<div class="text-center py-12">
						<Wrench class="h-12 w-12 text-gray-400 mx-auto mb-4" />
						<h3 class="text-lg font-medium text-gray-900 mb-2">Reminders coming soon</h3>
						<p class="text-gray-600">
							Set reminders for maintenance, registration renewals, and more
						</p>
					</div>
				</div>
			</TabsContent>

			<!-- Finance Tab -->
			<TabsContent value="loan" class="space-y-6">
				{#if vehicle.financing?.isActive}
					<div class="card">
						<div class="flex items-center gap-2 mb-4">
							<CreditCard class="h-5 w-5 text-primary-600" />
							<h2 class="text-lg font-semibold text-gray-900">
								{vehicle.financing.financingType === 'loan'
									? 'Loan'
									: vehicle.financing.financingType === 'lease'
										? 'Lease'
										: 'Financing'} Information
							</h2>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<p class="text-sm text-gray-600">Type</p>
								<p class="font-medium text-gray-900 capitalize">
									{vehicle.financing.financingType}
								</p>
							</div>

							<div>
								<p class="text-sm text-gray-600">
									{vehicle.financing.financingType === 'loan'
										? 'Lender'
										: vehicle.financing.financingType === 'lease'
											? 'Leasing Company'
											: 'Provider'}
								</p>
								<p class="font-medium text-gray-900">{vehicle.financing.provider}</p>
							</div>

							<div>
								<p class="text-sm text-gray-600">Current Balance</p>
								<p class="font-medium text-gray-900">
									{formatCurrency(vehicle.financing.currentBalance)}
								</p>
							</div>

							<div>
								<p class="text-sm text-gray-600">Original Amount</p>
								<p class="font-medium text-gray-900">
									{formatCurrency(vehicle.financing.originalAmount)}
								</p>
							</div>

							{#if vehicle.financing.apr !== undefined && vehicle.financing.apr !== null}
								<div>
									<p class="text-sm text-gray-600">APR</p>
									<p class="font-medium text-gray-900">{vehicle.financing.apr}%</p>
								</div>
							{/if}

							<div>
								<p class="text-sm text-gray-600">
									{vehicle.financing.financingType === 'lease' ? 'Lease' : ''} Payment
								</p>
								<p class="font-medium text-gray-900">
									{formatCurrency(vehicle.financing.paymentAmount)}
								</p>
							</div>

							<div>
								<p class="text-sm text-gray-600">Term</p>
								<p class="font-medium text-gray-900">{vehicle.financing.termMonths} months</p>
							</div>

							{#if vehicle.financing.financingType === 'lease'}
								{#if vehicle.financing.residualValue}
									<div>
										<p class="text-sm text-gray-600">Residual Value</p>
										<p class="font-medium text-gray-900">
											{formatCurrency(vehicle.financing.residualValue)}
										</p>
									</div>
								{/if}

								{#if vehicle.financing.mileageLimit}
									<div>
										<p class="text-sm text-gray-600">Annual Mileage Limit</p>
										<p class="font-medium text-gray-900">
											{vehicle.financing.mileageLimit.toLocaleString()} miles
										</p>
									</div>
								{/if}

								{#if vehicle.financing.excessMileageFee}
									<div>
										<p class="text-sm text-gray-600">Excess Mileage Fee</p>
										<p class="font-medium text-gray-900">
											{formatCurrency(vehicle.financing.excessMileageFee)}/mile
										</p>
									</div>
								{/if}
							{/if}
						</div>

						<!-- Progress Bar -->
						<div class="mt-4 pt-4 border-t border-gray-200">
							<div class="flex justify-between text-sm text-gray-600 mb-2">
								<span>
									{vehicle.financing.financingType === 'loan'
										? 'Loan'
										: vehicle.financing.financingType === 'lease'
											? 'Lease'
											: 'Payment'} Progress
								</span>
								<span>
									{Math.round(
										((vehicle.financing.originalAmount - vehicle.financing.currentBalance) /
											vehicle.financing.originalAmount) *
											100
									)}% paid
								</span>
							</div>
							<div class="w-full bg-gray-200 rounded-full h-2">
								<div
									class="bg-primary-600 h-2 rounded-full transition-all duration-300"
									style="width: {((vehicle.financing.originalAmount -
										vehicle.financing.currentBalance) /
										vehicle.financing.originalAmount) *
										100}%"
								></div>
							</div>
						</div>
					</div>
				{:else}
					<div class="card">
						<div class="text-center py-12">
							<CreditCard class="h-12 w-12 text-gray-400 mx-auto mb-4" />
							<h3 class="text-lg font-medium text-gray-900 mb-2">No active financing</h3>
							<p class="text-gray-600">This vehicle doesn't have active financing</p>
						</div>
					</div>
				{/if}
			</TabsContent>
		</Tabs>
	</div>

	<!-- Floating Action Button -->
	<Button
		href="/vehicles/{vehicleId}/expenses/new"
		class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto sm:rounded-full rounded-full group !bg-gradient-to-r !from-primary-600 !to-primary-700 hover:!from-primary-700 hover:!to-primary-800 !text-white shadow-2xl hover:shadow-primary-500/50 transition-all duration-300 sm:hover:scale-110 !z-50 h-16 sm:h-16 !pl-6 !pr-10 !border-0 !justify-center"
	>
		<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
		<span class="font-bold text-lg">Add Expense</span>
	</Button>

	<!-- Delete Confirmation AlertDialog -->
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
						<div>
							<p class="font-medium text-gray-900">
								{expenseToDelete.description ||
									categoryLabels[expenseToDelete.category] ||
									'Expense'}
							</p>
							<p class="text-sm text-gray-600">
								{formatDate(new Date(expenseToDelete.date))} • {formatCurrency(
									expenseToDelete.amount
								)}
							</p>
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
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
						Deleting...
					{:else}
						<Trash2 class="h-4 w-4 mr-2" />
						Delete
					{/if}
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
{:else}
	<div class="text-center py-12">
		<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
		<h3 class="text-lg font-medium text-gray-900 mb-2">Vehicle not found</h3>
		<p class="text-gray-600 mb-4">
			The vehicle you're looking for doesn't exist or you don't have access to it.
		</p>
		<button onclick={() => goto('/vehicles')} class="btn btn-primary"> Back to Vehicles </button>
	</div>
{/if}
