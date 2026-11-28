<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import { Shield, Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import PolicyList from './PolicyList.svelte';
	import { insuranceApi } from '#lib/services/insurance-api.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import type { InsurancePolicy } from '#lib/types/index.ts';

	interface Props {
		vehicleId: string;
		readOnly?: boolean;
	}

	let { vehicleId, readOnly = false }: Props = $props();

	let policies = $state<InsurancePolicy[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		isLoading = true;
		error = null;
		try {
			policies = await insuranceApi.getPoliciesForVehicle(vehicleId);
		} catch (err) {
			error = userFacingErrorMessage(err);
			logLoadFailure(err, "Couldn't load insurance policies");
		} finally {
			isLoading = false;
		}
	}

	function handleAddPolicy() {
		gotoWithQuery(resolve(routes.insuranceNew), {
			vehicleId,
			returnTo: `/vehicles/${vehicleId}`
		});
	}

	function handleEditPolicy(policy: InsurancePolicy) {
		gotoWithQuery(resolve(paramRoutes.insurancePolicyEdit, { id: policy.id }), {
			returnTo: `/vehicles/${vehicleId}`
		});
	}
</script>

{#if isLoading}
	<div class="space-y-3" aria-hidden="true" data-testid="insurance-tab-loading">
		<Skeleton class="h-5 w-40" />
		<Skeleton class="h-32 w-full" />
	</div>
{:else if error}
	<LoadErrorCard title="Couldn't load this car's insurance" message={error} onRetry={loadData} />
{:else if policies.length === 0}
	<EmptyState level={2}>
		{#snippet icon()}
			<Shield class="mb-4 h-12 w-12 text-muted-foreground" />
		{/snippet}
		{#snippet title()}No insurance policies{/snippet}
		{#snippet description()}
			{#if readOnly}
				This vehicle has no insurance policies.
			{:else}
				Add your first insurance policy to track coverage, costs, and documents.
			{/if}
		{/snippet}
		{#snippet action()}
			{#if !readOnly}
				<Button onclick={handleAddPolicy}>
					<Plus class="mr-2 h-4 w-4" />
					Add policy
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-4">
		<div class="flex items-center justify-between gap-3">
			<h2 class="text-lg font-semibold text-foreground">Insurance policies</h2>
			{#if !readOnly}
				<Button variant="outline" onclick={handleAddPolicy}>
					<Plus class="mr-2 h-4 w-4" />
					Add policy
				</Button>
			{/if}
		</div>

		<PolicyList {policies} {readOnly} level={3} onEdit={handleEditPolicy} onRefresh={loadData} />
	</div>
{/if}
