<script lang="ts">
	import PolicyCard from './PolicyCard.svelte';
	import { groupPoliciesByActive } from '$lib/utils/insurance';
	import type { InsurancePolicy, Vehicle } from '$lib/types';

	interface Props {
		policies: InsurancePolicy[];
		vehicleNameMap?: Map<string, string>;
		vehicles?: Vehicle[];
		editTermId?: string | null;
		editPolicyId?: string | null;
		onEdit: (_policy: InsurancePolicy) => void;
		onDelete: (_policyId: string) => void;
		onRefresh: () => Promise<void>;
	}

	let {
		policies,
		vehicleNameMap = new Map(),
		vehicles = [],
		editTermId = null,
		editPolicyId = null,
		onEdit,
		onDelete,
		onRefresh
	}: Props = $props();

	let grouped = $derived(groupPoliciesByActive(policies));

	function getVehicleNames(policy: InsurancePolicy): string[] {
		return policy.vehicleIds
			.map(id => vehicleNameMap.get(id))
			.filter((name): name is string => !!name);
	}
</script>

<div class="space-y-6">
	{#if grouped.active.length > 0}
		<div class="space-y-3">
			<h4 class="text-sm font-medium text-muted-foreground">Active Policies</h4>
			{#each grouped.active as policy (policy.id)}
				<PolicyCard
					{policy}
					vehicleNames={getVehicleNames(policy)}
					{vehicles}
					autoEditTermId={editPolicyId === policy.id ? editTermId : null}
					{onEdit}
					{onDelete}
					{onRefresh}
				/>
			{/each}
		</div>
	{/if}

	{#if grouped.inactive.length > 0}
		<div class="space-y-3">
			<h4 class="text-sm font-medium text-muted-foreground">Inactive Policies</h4>
			{#each grouped.inactive as policy (policy.id)}
				<PolicyCard
					{policy}
					vehicleNames={getVehicleNames(policy)}
					{vehicles}
					autoEditTermId={editPolicyId === policy.id ? editTermId : null}
					{onEdit}
					{onDelete}
					{onRefresh}
				/>
			{/each}
		</div>
	{/if}
</div>
