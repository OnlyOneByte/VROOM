<script lang="ts">
	import { CreditCard } from 'lucide-svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import StatCard from '$lib/components/ui/stat-card.svelte';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { settingsStore } from '$lib/stores/settings';
	import { getDistanceUnitLabel } from '$lib/utils/units';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { Vehicle } from '$lib/types';

	interface Props {
		vehicle: Vehicle;
	}

	let { vehicle }: Props = $props();

	let progressPercentage = $derived(
		vehicle.financing?.isActive
			? ((vehicle.financing.originalAmount - vehicle.financing.currentBalance) /
					vehicle.financing.originalAmount) *
					100
			: 0
	);
</script>

{#if vehicle.financing?.isActive}
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<CreditCard class="h-5 w-5" />
				{vehicle.financing.financingType === 'loan'
					? 'Loan'
					: vehicle.financing.financingType === 'lease'
						? 'Lease'
						: 'Financing'} Information
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
				<div class="capitalize">
					<StatCard label="Type" value={vehicle.financing.financingType} />
				</div>
				<StatCard
					label={vehicle.financing.financingType === 'loan'
						? 'Lender'
						: vehicle.financing.financingType === 'lease'
							? 'Leasing Company'
							: 'Provider'}
					value={vehicle.financing.provider}
				/>
				<StatCard
					label="Current Balance"
					value={formatCurrency(vehicle.financing.currentBalance)}
				/>
				<StatCard
					label="Original Amount"
					value={formatCurrency(vehicle.financing.originalAmount)}
				/>

				{#if vehicle.financing.apr !== undefined && vehicle.financing.apr !== null}
					<StatCard label="APR" value="{vehicle.financing.apr}%" />
				{/if}

				<StatCard
					label="{vehicle.financing.financingType === 'lease' ? 'Lease' : ''} Payment"
					value={formatCurrency(vehicle.financing.paymentAmount)}
				/>
				<StatCard label="Term" value={vehicle.financing.termMonths} unit="months" />

				{#if vehicle.financing.financingType === 'lease'}
					{#if vehicle.financing.residualValue}
						<StatCard
							label="Residual Value"
							value={formatCurrency(vehicle.financing.residualValue)}
						/>
					{/if}

					{#if vehicle.financing.mileageLimit}
						<StatCard
							label="Annual {$settingsStore.settings?.distanceUnit === 'kilometers'
								? 'Distance'
								: 'Mileage'} Limit"
							value={vehicle.financing.mileageLimit.toLocaleString()}
							unit={getDistanceUnitLabel($settingsStore.settings?.distanceUnit || 'miles', false)}
						/>
					{/if}

					{#if vehicle.financing.excessMileageFee}
						<StatCard
							label="Excess {$settingsStore.settings?.distanceUnit === 'kilometers'
								? 'Distance'
								: 'Mileage'} Fee"
							value={formatCurrency(vehicle.financing.excessMileageFee)}
							unit="/{getDistanceUnitLabel($settingsStore.settings?.distanceUnit || 'miles', true)}"
						/>
					{/if}
				{/if}
			</div>

			<!-- Progress Bar -->
			<div class="mt-6 pt-6 border-t">
				<div class="flex justify-between text-sm text-muted-foreground mb-2">
					<span>
						{vehicle.financing.financingType === 'loan'
							? 'Loan'
							: vehicle.financing.financingType === 'lease'
								? 'Lease'
								: 'Payment'} Progress
					</span>
					<span class="font-semibold">
						{Math.round(progressPercentage)}% paid
					</span>
				</div>
				<div class="w-full bg-secondary rounded-full h-3">
					<div
						class="bg-primary h-3 rounded-full transition-all duration-300"
						style="width: {progressPercentage}%"
					></div>
				</div>
			</div>
		</CardContent>
	</Card>
{:else}
	<EmptyState>
		{#snippet icon()}
			<CreditCard class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			No active financing
		{/snippet}
		{#snippet description()}
			This vehicle doesn't have active financing
		{/snippet}
	</EmptyState>
{/if}
