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
		Calendar, 
		Gauge, 
		TrendingUp,
		CreditCard,
		Fuel,
		Wrench
	} from 'lucide-svelte';
	import type { Vehicle, Expense } from '$lib/types.js';

	const vehicleId = $page.params.id;

	// Component state
	let isLoading = $state(true);
	let vehicle = $state<Vehicle | null>(null);
	let expenses = $state<Expense[]>([]);
	let vehicleStats = $state({
		totalExpenses: 0,
		recentExpenses: 0,
		expenseCount: 0,
		avgMpg: 0,
		lastExpenseDate: null as Date | null,
		expensesByCategory: {} as Record<string, number>
	});

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
			const response = await fetch(`/api/vehicles/${vehicleId}/expenses`, {
				credentials: 'include'
			});

			if (response.ok) {
				expenses = await response.json();
				calculateStats();
			}
		} catch (error) {
			console.error('Error loading expenses:', error);
		} finally {
			isLoading = false;
		}
	}

	function calculateStats() {
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		
		const recentExpenses = expenses.filter(e => new Date(e.date) > thirtyDaysAgo);
		const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0);
		const recentAmount = recentExpenses.reduce((sum, e) => sum + e.amount, 0);
		
		// Calculate expenses by category
		const expensesByCategory = expenses.reduce((acc, expense) => {
			acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
			return acc;
		}, {} as Record<string, number>);

		// Calculate fuel efficiency
		const fuelExpenses = expenses.filter(e => e.type === 'fuel' && e.gallons && e.mileage);
		let avgMpg = 0;
		if (fuelExpenses.length > 1) {
			const mpgValues = [];
			for (let i = 1; i < fuelExpenses.length; i++) {
				const current = fuelExpenses[i];
				const previous = fuelExpenses[i - 1];
				if (current.mileage && previous.mileage && current.gallons) {
					const miles = current.mileage - previous.mileage;
					const mpg = miles / current.gallons;
					if (mpg > 0 && mpg < 100) {
						mpgValues.push(mpg);
					}
				}
			}
			avgMpg = mpgValues.length > 0 ? mpgValues.reduce((sum, mpg) => sum + mpg, 0) / mpgValues.length : 0;
		}

		vehicleStats = {
			totalExpenses: totalAmount,
			recentExpenses: recentAmount,
			expenseCount: expenses.length,
			avgMpg: Math.round(avgMpg * 10) / 10,
			lastExpenseDate: expenses.length > 0 ? new Date(Math.max(...expenses.map(e => new Date(e.date).getTime()))) : null,
			expensesByCategory
		};
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

	function getCategoryIcon(category: string) {
		switch (category) {
			case 'operating': return Fuel;
			case 'maintenance': return Wrench;
			case 'financial': return CreditCard;
			default: return DollarSign;
		}
	}

	function getCategoryColor(category: string): string {
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
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<button 
					onclick={() => goto('/vehicles')}
					class="btn btn-secondary p-2"
				>
					<ArrowLeft class="h-4 w-4" />
				</button>
				<div>
					<h1 class="text-2xl font-bold text-gray-900">{getVehicleDisplayName()}</h1>
					<p class="text-gray-600">{vehicle.year} {vehicle.make} {vehicle.model}</p>
				</div>
			</div>

			<div class="flex gap-2">
				<a 
					href="/vehicles/{vehicleId}/edit"
					class="btn btn-secondary inline-flex items-center gap-2"
				>
					<Edit class="h-4 w-4" />
					Edit
				</a>
				<a 
					href="/vehicles/{vehicleId}/expenses/new"
					class="btn btn-primary inline-flex items-center gap-2"
				>
					<Plus class="h-4 w-4" />
					Add Expense
				</a>
			</div>
		</div>

		<!-- Vehicle Overview Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Total Expenses</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(vehicleStats.totalExpenses)}</p>
					</div>
					<DollarSign class="h-8 w-8 text-primary-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Last 30 Days</p>
						<p class="text-2xl font-bold text-gray-900">{formatCurrency(vehicleStats.recentExpenses)}</p>
					</div>
					<TrendingUp class="h-8 w-8 text-green-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">Expense Count</p>
						<p class="text-2xl font-bold text-gray-900">{vehicleStats.expenseCount}</p>
					</div>
					<Calendar class="h-8 w-8 text-blue-600" />
				</div>
			</div>
			
			<div class="card-compact">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-medium text-gray-600">
							{vehicleStats.avgMpg > 0 ? 'Avg MPG' : 'Last Activity'}
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

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Vehicle Details -->
			<div class="lg:col-span-2 space-y-6">
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
								<p class="font-medium text-gray-900">{vehicle.initialMileage.toLocaleString()} mi</p>
							</div>
						{/if}
						
						{#if vehicle.purchaseDate}
							<div>
								<p class="text-sm text-gray-600">Purchase Date</p>
								<p class="font-medium text-gray-900">{formatDate(new Date(vehicle.purchaseDate))}</p>
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

				<!-- Loan Information -->
				{#if vehicle.loan?.isActive}
					<div class="card">
						<div class="flex items-center gap-2 mb-4">
							<CreditCard class="h-5 w-5 text-primary-600" />
							<h2 class="text-lg font-semibold text-gray-900">Loan Information</h2>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<p class="text-sm text-gray-600">Lender</p>
								<p class="font-medium text-gray-900">{vehicle.loan.lender}</p>
							</div>
							
							<div>
								<p class="text-sm text-gray-600">Current Balance</p>
								<p class="font-medium text-gray-900">{formatCurrency(vehicle.loan.currentBalance)}</p>
							</div>
							
							<div>
								<p class="text-sm text-gray-600">Original Amount</p>
								<p class="font-medium text-gray-900">{formatCurrency(vehicle.loan.originalAmount)}</p>
							</div>
							
							<div>
								<p class="text-sm text-gray-600">APR</p>
								<p class="font-medium text-gray-900">{vehicle.loan.apr}%</p>
							</div>
							
							<div>
								<p class="text-sm text-gray-600">Monthly Payment</p>
								<p class="font-medium text-gray-900">{formatCurrency(vehicle.loan.standardPayment.amount)}</p>
							</div>
							
							<div>
								<p class="text-sm text-gray-600">Term</p>
								<p class="font-medium text-gray-900">{vehicle.loan.termMonths} months</p>
							</div>
						</div>

						<!-- Loan Progress -->
						<div class="mt-4 pt-4 border-t border-gray-200">
							<div class="flex justify-between text-sm text-gray-600 mb-2">
								<span>Loan Progress</span>
								<span>
									{Math.round(((vehicle.loan.originalAmount - vehicle.loan.currentBalance) / vehicle.loan.originalAmount) * 100)}% paid
								</span>
							</div>
							<div class="w-full bg-gray-200 rounded-full h-2">
								<div 
									class="bg-primary-600 h-2 rounded-full transition-all duration-300"
									style="width: {((vehicle.loan.originalAmount - vehicle.loan.currentBalance) / vehicle.loan.originalAmount) * 100}%"
								></div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Recent Expenses -->
				<div class="card">
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-lg font-semibold text-gray-900">Recent Expenses</h2>
						<a 
							href="/vehicles/{vehicleId}/expenses"
							class="text-primary-600 hover:text-primary-700 text-sm font-medium"
						>
							View All
						</a>
					</div>

					{#if expenses.length === 0}
						<div class="text-center py-8">
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
						</div>
					{:else}
						<div class="space-y-3">
							{#each expenses.slice(0, 5) as expense}
								{@const IconComponent = getCategoryIcon(expense.category)}
								<div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
									<div class="flex items-center gap-3">
										<div class="p-2 rounded-lg {getCategoryColor(expense.category)}">
											<IconComponent class="h-4 w-4" />
										</div>
										<div>
											<p class="font-medium text-gray-900">{expense.description || expense.type}</p>
											<p class="text-sm text-gray-600">{formatDate(new Date(expense.date))}</p>
										</div>
									</div>
									<p class="font-semibold text-gray-900">{formatCurrency(expense.amount)}</p>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<!-- Sidebar -->
			<div class="space-y-6">
				<!-- Expense Categories -->
				{#if Object.keys(vehicleStats.expensesByCategory).length > 0}
					<div class="card">
						<h3 class="text-lg font-semibold text-gray-900 mb-4">Expenses by Category</h3>
						<div class="space-y-3">
							{#each Object.entries(vehicleStats.expensesByCategory) as [category, amount]}
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div class="w-3 h-3 rounded-full {getCategoryColor(category).split(' ')[1]}"></div>
										<span class="text-sm text-gray-700">{formatCategoryName(category)}</span>
									</div>
									<span class="text-sm font-medium text-gray-900">{formatCurrency(amount)}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Quick Actions -->
				<div class="card">
					<h3 class="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
					<div class="space-y-2">
						<a 
							href="/vehicles/{vehicleId}/expenses/new"
							class="btn btn-primary w-full justify-center"
						>
							Add Expense
						</a>
						<a 
							href="/vehicles/{vehicleId}/analytics"
							class="btn btn-secondary w-full justify-center"
						>
							View Analytics
						</a>
						<a 
							href="/vehicles/{vehicleId}/edit"
							class="btn btn-outline w-full justify-center"
						>
							Edit Vehicle
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="text-center py-12">
		<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
		<h3 class="text-lg font-medium text-gray-900 mb-2">Vehicle not found</h3>
		<p class="text-gray-600 mb-4">The vehicle you're looking for doesn't exist or you don't have access to it.</p>
		<button 
			onclick={() => goto('/vehicles')}
			class="btn btn-primary"
		>
			Back to Vehicles
		</button>
	</div>
{/if}