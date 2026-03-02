<script lang="ts">
	import { onMount } from 'svelte';
	import { Shield, Plus, CircleAlert } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import PolicyList from '$lib/components/insurance/PolicyList.svelte';
	import PolicyForm from '$lib/components/insurance/PolicyForm.svelte';
	import { insuranceApi } from '$lib/services/insurance-api';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	let policies = $state<InsurancePolicy[]>([]);
	let vehicles = $state<Vehicle[]>([]);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let showPolicyForm = $state(false);
	let editingPolicy = $state<InsurancePolicy | null>(null);

	// Build a map of vehicleId → display name for showing on policy cards
	let vehicleNameMap = $derived(new Map(vehicles.map((v) => [v.id, getVehicleDisplayName(v)])));

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
		editingPolicy = null;
		showPolicyForm = true;
	}

	function handleEditPolicy(policy: InsurancePolicy) {
		editingPolicy = policy;
		showPolicyForm = true;
	}

	async function handleDeletePolicy(policyId: string) {
		try {
			await insuranceApi.deletePolicy(policyId);
			policies = policies.filter(p => p.id !== policyId);
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to delete policy');
		}
	}

	async function handlePolicySuccess() {
		showPolicyForm = false;
		editingPolicy = null;
		await loadData();
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
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Insurance</h1>
			<p class="text-muted-foreground mt-1">Manage your insurance policies across all vehicles</p>
		</div>
		<div class="rounded-lg border border-destructive bg-destructive/10 p-6">
			<div class="flex items-center gap-2 text-sm text-destructive">
				<CircleAlert class="h-5 w-5 shrink-0" />
				<span>{error}</span>
			</div>
			<Button variant="outline" size="sm" class="mt-3" onclick={loadData}>Try Again</Button>
		</div>
	</div>
{:else}
	<div class="space-y-6 pb-24 sm:pb-0">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold tracking-tight">Insurance</h1>
				<p class="text-muted-foreground mt-1">Manage your insurance policies across all vehicles</p>
			</div>
			<Button class="hidden sm:flex" onclick={handleAddPolicy}>
				<Plus class="mr-2 h-4 w-4" />
				New Policy
			</Button>
		</div>

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
				onEdit={handleEditPolicy}
				onDelete={handleDeletePolicy}
				onRefresh={loadData}
			/>
		{/if}
	</div>

	<!-- Floating Action Button (mobile) -->
	<Button
		class="
			fixed bottom-4 left-4 right-4 z-50 h-16 rounded-full
			sm:bottom-8 sm:right-8 sm:left-auto sm:w-auto
			flex items-center justify-center gap-2 pl-6 pr-10
			bg-foreground hover:bg-foreground/90
			text-background shadow-2xl
			transition-all duration-300 sm:hover:scale-110
			border-0 group
		"
		aria-label="New insurance policy"
		onclick={handleAddPolicy}
	>
		<Plus class="h-6 w-6 transition-transform duration-300 group-hover:rotate-90" />
		<span class="font-bold text-lg">New Policy</span>
	</Button>
{/if}

<PolicyForm
	bind:open={showPolicyForm}
	vehicleId=""
	policy={editingPolicy}
	{vehicles}
	onSuccess={handlePolicySuccess}
/>
