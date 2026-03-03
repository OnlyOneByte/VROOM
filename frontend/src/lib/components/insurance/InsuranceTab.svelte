<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Shield, Plus, LoaderCircle, CircleAlert } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PolicyList from './PolicyList.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { InsurancePolicy } from '$lib/types';

	interface Props {
		vehicleId: string;
	}

	let { vehicleId }: Props = $props();

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
			const message = err instanceof Error ? err.message : 'Failed to load insurance policies';
			error = message;
			handleErrorWithNotification(err, 'Failed to load insurance policies');
		} finally {
			isLoading = false;
		}
	}

	function handleAddPolicy() {
		goto(`/insurance/new?vehicleId=${vehicleId}&returnTo=/vehicles/${vehicleId}`);
	}

	function handleEditPolicy(policy: InsurancePolicy) {
		goto(`/insurance/${policy.id}/edit?returnTo=/vehicles/${vehicleId}`);
	}
</script>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
	</div>
{:else if error}
	<div class="rounded-lg border border-destructive bg-destructive/10 p-4">
		<div class="flex items-center gap-2 text-sm text-destructive">
			<CircleAlert class="h-4 w-4 shrink-0" />
			<span>{error}</span>
		</div>
		<Button variant="outline" size="sm" class="mt-3" onclick={loadData}>Try Again</Button>
	</div>
{:else if policies.length === 0}
	<EmptyState>
		{#snippet icon()}
			<div class="mb-4 rounded-full bg-muted p-4">
				<Shield class="h-8 w-8 text-muted-foreground" />
			</div>
		{/snippet}
		{#snippet title()}No insurance policies{/snippet}
		{#snippet description()}
			Add your first insurance policy to track coverage, costs, and documents.
		{/snippet}
		{#snippet action()}
			<Button onclick={handleAddPolicy}>
				<Plus class="mr-2 h-4 w-4" />
				Add Policy
			</Button>
		{/snippet}
	</EmptyState>
{:else}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold text-foreground">Insurance Policies</h3>
			<Button variant="outline" size="sm" onclick={handleAddPolicy}>
				<Plus class="mr-2 h-4 w-4" />
				Add Policy
			</Button>
		</div>

		<PolicyList {policies} onEdit={handleEditPolicy} onRefresh={loadData} />
	</div>
{/if}
