<script lang="ts">
	import { Pencil, Trash2, RefreshCw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import type { InsuranceTerm } from '$lib/types';

	interface Props {
		term: InsuranceTerm;
		isCurrent?: boolean;
		vehicleNames?: string[];
		onEdit?: (_term: InsuranceTerm) => void;
		onDelete?: (_term: InsuranceTerm) => void;
		onRenew?: () => void;
	}

	let { term, isCurrent = false, vehicleNames = [], onEdit, onDelete, onRenew }: Props = $props();

	function handleDelete() {
		if (confirm('Delete this term? Associated expenses will be preserved but unlinked.')) {
			onDelete?.(term);
		}
	}
</script>

<div class="rounded-lg border p-3 space-y-2 {isCurrent ? 'bg-muted/30' : 'bg-background'}">
	<div class="flex items-center justify-between">
		<Badge variant="secondary" class="text-xs">
			{isCurrent ? 'Current Term' : 'Past Term'}
		</Badge>
		<div class="flex items-center gap-0.5">
			{#if onEdit}
				<Button
					variant="ghost"
					size="icon"
					class="h-7 w-7"
					onclick={() => onEdit(term)}
					title="Edit term"
				>
					<Pencil class="h-3 w-3" />
				</Button>
			{/if}
			{#if onDelete}
				<Button
					variant="ghost"
					size="icon"
					class="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
					onclick={handleDelete}
					title="Delete term"
				>
					<Trash2 class="h-3 w-3" />
				</Button>
			{/if}
			{#if isCurrent && onRenew}
				<Button variant="outline" size="sm" class="h-7 text-xs ml-1" onclick={onRenew}>
					<RefreshCw class="mr-1 h-3 w-3" />
					Renew
				</Button>
			{/if}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
		{#if isCurrent}
			<div class="text-muted-foreground">Expires</div>
			<div class="font-medium text-foreground">{formatDate(term.endDate)}</div>
		{:else}
			<div class="text-muted-foreground">Start</div>
			<div class="font-medium text-foreground">{formatDate(term.startDate)}</div>
			<div class="text-muted-foreground">End</div>
			<div class="font-medium text-foreground">{formatDate(term.endDate)}</div>
		{/if}
		{#if term.totalCost !== undefined}
			<div class="text-muted-foreground">Total Cost</div>
			<div class="font-semibold text-foreground">
				{formatCurrency(term.totalCost)}
			</div>
		{/if}
		{#if term.monthlyCost !== undefined}
			<div class="text-muted-foreground">Monthly</div>
			<div class="font-medium text-foreground">
				{formatCurrency(term.monthlyCost)}/mo
			</div>
		{/if}
		{#if vehicleNames.length > 0}
			<div class="text-muted-foreground">Vehicles</div>
			<div class="font-medium text-foreground">{vehicleNames.join(', ')}</div>
		{/if}
	</div>

	{#if term.coverageDescription}
		<p class="text-xs text-muted-foreground line-clamp-2">
			{term.coverageDescription}
		</p>
	{/if}
</div>
