<script lang="ts">
	import { Ellipsis, Pencil, Trash2 } from '@lucide/svelte';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { hasTermEnded } from '#lib/utils/insurance.ts';
	import type { InsuranceTerm } from '#lib/types/index.ts';

	interface Props {
		term: InsuranceTerm;
		isCurrent?: boolean;
		vehicleNames?: string[];
		onEdit?: (_term: InsuranceTerm) => void;
		onDelete?: (_term: InsuranceTerm) => void;
	}

	let { term, isCurrent = false, vehicleNames = [], onEdit, onDelete }: Props = $props();

	let confirmOpen = $state(false);
	let menuOpen = $state(false);
	let ended = $derived(hasTermEnded(term));
	let termLabel = $derived(isCurrent ? (ended ? 'Latest Term' : 'Current Term') : 'Past Term');
</script>

<div class={isCurrent ? 'space-y-2' : 'space-y-2 rounded-lg border bg-background p-3'}>
	<div class="flex items-center justify-between">
		<Badge variant="secondary" class="text-xs">
			{termLabel}
		</Badge>
		<div class="flex items-center gap-2">
			{#if onEdit || onDelete}
				<Popover.Root bind:open={menuOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="size-10 sm:size-9"
								title="Term actions"
								aria-label="Term actions"
							>
								<Ellipsis />
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content align="end" class="flex w-44 flex-col gap-1 p-1">
						{#if onEdit}
							<Button
								variant="ghost"
								class="h-10 w-full justify-start"
								onclick={() => {
									menuOpen = false;
									onEdit(term);
								}}
							>
								<Pencil />
								Edit term
							</Button>
						{/if}
						{#if onDelete}
							<Button
								variant="ghost"
								class="h-10 w-full justify-start"
								onclick={() => {
									menuOpen = false;
									confirmOpen = true;
								}}
							>
								<Trash2 />
								Delete term
							</Button>
						{/if}
					</Popover.Content>
				</Popover.Root>
			{/if}
		</div>
	</div>

	<dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs">
		{#if isCurrent}
			<dt class="text-muted-foreground">{ended ? 'Ended' : 'Expires'}</dt>
			<dd class="font-medium text-foreground">{formatDate(term.endDate)}</dd>
		{:else}
			<dt class="text-muted-foreground">Start</dt>
			<dd class="font-medium text-foreground">{formatDate(term.startDate)}</dd>
			<dt class="text-muted-foreground">End</dt>
			<dd class="font-medium text-foreground">{formatDate(term.endDate)}</dd>
		{/if}
		{#if term.totalCost !== undefined}
			<dt class="text-muted-foreground">Total Cost</dt>
			<dd class="font-semibold text-foreground">
				{formatCurrency(term.totalCost)}
			</dd>
		{/if}
		{#if term.monthlyCost !== undefined}
			<dt class="text-muted-foreground">Monthly</dt>
			<dd class="font-medium text-foreground">
				{formatCurrency(term.monthlyCost)}/mo
			</dd>
		{/if}
		{#if vehicleNames.length > 0}
			<dt class="text-muted-foreground">Vehicles</dt>
			<dd class="font-medium text-foreground">{vehicleNames.join(', ')}</dd>
		{/if}
	</dl>

	{#if term.coverageDescription}
		<p class="text-xs text-muted-foreground line-clamp-2">
			{term.coverageDescription}
		</p>
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete term?"
	description="This term's auto-created premium expense(s) will also be permanently deleted. This cannot be undone."
	onConfirm={() => onDelete?.(term)}
/>
