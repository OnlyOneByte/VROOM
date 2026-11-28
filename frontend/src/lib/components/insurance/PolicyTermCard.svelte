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
	const figure =
		'font-(family-name:--font-fig) text-lg leading-tight font-semibold text-foreground tabular-nums';
	let termLabel = $derived(isCurrent ? (ended ? 'Latest term' : 'Current term') : 'Past term');
</script>

<div class={isCurrent ? 'space-y-3' : 'space-y-2 border-t border-border pt-3'}>
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
								class="size-10"
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

	<dl
		class={isCurrent
			? 'grid grid-cols-3 gap-x-4 gap-y-3 sm:gap-x-6'
			: 'grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs'}
	>
		{#if isCurrent}
			<div>
				<dt class="text-xs text-muted-foreground">{ended ? 'Ended' : 'Expires'}</dt>
				<dd class={figure}>{formatDate(term.endDate)}</dd>
			</div>
			{#if term.totalCost !== undefined}
				<div>
					<dt class="text-xs text-muted-foreground">Total cost</dt>
					<dd class={figure}>{formatCurrency(term.totalCost)}</dd>
				</div>
			{/if}
			{#if term.monthlyCost !== undefined}
				<div>
					<dt class="text-xs text-muted-foreground">Monthly</dt>
					<dd class={figure}>{formatCurrency(term.monthlyCost)}/mo</dd>
				</div>
			{/if}
			{#if vehicleNames.length > 0}
				<div class="col-span-full">
					<dt class="text-xs text-muted-foreground">Vehicles</dt>
					<dd class="text-sm font-medium break-words text-foreground">
						{vehicleNames.join(', ')}
					</dd>
				</div>
			{/if}
		{:else}
			<dt class="text-muted-foreground">Start</dt>
			<dd class="font-medium text-foreground">{formatDate(term.startDate)}</dd>
			<dt class="text-muted-foreground">End</dt>
			<dd class="font-medium text-foreground">{formatDate(term.endDate)}</dd>
			{#if term.totalCost !== undefined}
				<dt class="text-muted-foreground">Total cost</dt>
				<dd class="font-semibold text-foreground tabular-nums">
					{formatCurrency(term.totalCost)}
				</dd>
			{/if}
			{#if term.monthlyCost !== undefined}
				<dt class="text-muted-foreground">Monthly</dt>
				<dd class="font-medium text-foreground tabular-nums">
					{formatCurrency(term.monthlyCost)}/mo
				</dd>
			{/if}
			{#if vehicleNames.length > 0}
				<dt class="text-muted-foreground">Vehicles</dt>
				<dd class="font-medium break-words text-foreground">{vehicleNames.join(', ')}</dd>
			{/if}
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
