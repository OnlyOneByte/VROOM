<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '$lib/routes';
	import { onMount } from 'svelte';
	import { Shield, Plus, CircleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import FloatingActionButton from '$lib/components/common/floating-action-button.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PolicyList from '$lib/components/insurance/PolicyList.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	let policies = $state<InsurancePolicy[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Build a map of vehicleId → display name for showing on policy cards
	let vehicleNameMap = $derived(new Map(vehicles.map(v => [v.id, getVehicleDisplayName(v)])));

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		error = null;
		try {
			const [policiesData, vehiclesData] = await Promise.all([
				insuranceApi.getAllPolicies(),
				vehicleApi.getVehicles()
			]);
			policies = policiesData;
			vehicles = vehiclesData;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to load insurance data';
			error = message;
			handleErrorWithNotification(err, 'Failed to load insurance data');
		} finally {
			isLoading = false;
		}
	}

	function handleAddPolicy() {
		goto(resolve(routes.insuranceNew));
	}

	function handleEditPolicy(policy: InsurancePolicy) {
		goto(resolve(paramRoutes.insurancePolicyEdit, { id: policy.id }));
	}
</script>

<svelte:head>
	<title>Insurance - VROOM Car Tracker</title>
	<meta name="description" content="Manage your vehicle insurance policies" />
</svelte:head>

{#if isLoading}
	<div class="space-y-6">
		<div>
			<Skeleton class="h-8 w-48 mb-2" />
			<Skeleton class="h-5 w-72" />
		</div>
		<Skeleton class="h-40 w-full" />
		<Skeleton class="h-64 w-full" />
	</div>
{:else if error}
	<div class="space-y-6">
		<PageHeader
			title="Insurance"
			description="Manage your insurance policies across all vehicles"
		/>
		<div class="rounded-lg border border-destructive bg-destructive/10 p-6">
			<div class="flex items-center gap-2 text-sm text-destructive">
				<CircleAlert class="h-5 w-5 shrink-0" />
				<span>{error}</span>
			</div>
			<Button variant="outline" size="sm" class="mt-3" onclick={loadData}>Try Again</Button>
		</div>
	</div>
{:else}
	<div class="space-y-6 pb-24">
		<!-- Header -->
		<PageHeader title="Insurance" description="Manage your insurance policies across all vehicles">
			{#snippet actions()}
				<Button class="hidden sm:flex" onclick={handleAddPolicy}>
					<Plus class="mr-2 h-4 w-4" />
					New Policy
				</Button>
			{/snippet}
		</PageHeader>

		{#if policies.length === 0}
			<EmptyState>
				{#snippet icon()}
					<div class="mb-4 rounded-full bg-muted p-4">
						<Shield class="h-8 w-8 text-muted-foreground" />
					</div>
				{/snippet}
				{#snippet title()}No insurance policies{/snippet}
				{#snippet description()}
					Add your first insurance policy to track coverage, costs, and documents across your
					vehicles.
				{/snippet}
				{#snippet action()}
					<Button onclick={handleAddPolicy}>
						<Plus class="mr-2 h-4 w-4" />
						Add Policy
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<PolicyList
				{policies}
				{vehicleNameMap}
				{vehicles}
				onEdit={handleEditPolicy}
				onRefresh={loadData}
			/>
		{/if}
	</div>

	<!-- Floating Action Button (mobile) -->
	<FloatingActionButton
		onclick={handleAddPolicy}
		label="New Policy"
		ariaLabel="New insurance policy"
	/>
{/if}
