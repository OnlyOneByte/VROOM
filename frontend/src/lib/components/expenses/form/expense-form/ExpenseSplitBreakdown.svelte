<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import SplitConfigEditor from '../../split/SplitConfigEditor.svelte';
	import type { Vehicle } from '$lib/types';
	import type { SplitAllocationDraft } from '$lib/utils/expense-helpers';
	import type { SplitMethod } from './split-config';

	interface Props {
		vehicles: Vehicle[];
		totalAmount: number;
		splitMethod: SplitMethod;
		allocations: SplitAllocationDraft[];
		onMethodChange: (_method: SplitMethod) => void;
		onAllocationsChange: (_allocations: SplitAllocationDraft[]) => void;
	}

	let {
		vehicles,
		totalAmount,
		splitMethod,
		allocations,
		onMethodChange,
		onAllocationsChange
	}: Props = $props();
</script>

<div class="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
	<div class="flex items-center gap-2">
		<GitBranch class="h-4 w-4 text-muted-foreground" />
		<span class="text-sm font-medium text-foreground">Split Breakdown</span>
	</div>
	<SplitConfigEditor
		{vehicles}
		{totalAmount}
		{splitMethod}
		{allocations}
		{onMethodChange}
		{onAllocationsChange}
	/>
</div>
