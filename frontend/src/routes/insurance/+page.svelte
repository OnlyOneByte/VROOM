<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { onMount } from 'svelte';
	import { Shield, Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import PolicyList from '#lib/components/insurance/PolicyList.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { isPolicyInForce } from '#lib/utils/insurance.ts';
	import type { InsurancePolicy, Vehicle } from '#lib/types/index.ts';

	let policies = $state<InsurancePolicy[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	let inForceCount = $derived(policies.filter(p => isPolicyInForce(p)).length);
	let headerDescription = $derived(
		isLoading || error || policies.length === 0
			? 'Coverage, costs and documents for every vehicle'
			: [
					`${inForceCount} in force`,
					policies.length > inForceCount ? `${policies.length - inForceCount} inactive` : null
				]
					.filter(Boolean)
					.join(' · ')
	);

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
			error = userFacingErrorMessage(err);
			logLoadFailure(err, "Couldn't load insurance data");
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

<div class="mx-auto max-w-5xl space-y-6">
	<PageHeader variant="display" title="Insurance" description={headerDescription}>
		{#snippet actions()}
			{#if !isLoading && !error && policies.length > 0 && vehicles.length > 0}
				<Button size="lg" onclick={handleAddPolicy}>
					<Plus class="mr-2 h-4 w-4" />
					Add Policy
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if isLoading}
		<div class="space-y-3" aria-hidden="true">
			<Skeleton class="h-5 w-32" />
			<Skeleton class="h-48 w-full" />
			<Skeleton class="h-48 w-full" />
		</div>
	{:else if error}
		<LoadErrorCard title="Couldn't load insurance" message={error} onRetry={loadData} />
	{:else if policies.length === 0 && vehicles.length === 0}
		<NoVehiclesEmptyState
			description="Every policy covers a vehicle. Add one, then track its coverage, costs and documents here."
		/>
	{:else if policies.length === 0}
		<EmptyState>
			{#snippet icon()}
				<Shield class="mb-4 h-12 w-12 text-muted-foreground" />
			{/snippet}
			{#snippet title()}No insurance policies{/snippet}
			{#snippet description()}
				Add your first insurance policy to track coverage, costs, and documents across your
				vehicles.
			{/snippet}
			{#snippet action()}
				<Button size="lg" onclick={handleAddPolicy}>
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
