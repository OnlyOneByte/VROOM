<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import RecurringExpenseBadge from '../RecurringExpenseBadge.svelte';
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getCategoryIcon } from '#lib/utils/expense-helpers.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
	import { expenseEditHref } from './expense-table-actions';
	import { fillLabel, rowTitle, tagsBesideCategory } from './expense-table-rows';
	import {
		MOBILE_ROW_ACTION_CLASS,
		MOBILE_ROW_ACTIONS_CONTAINER_CLASS,
		MOBILE_ROW_SUMMARY_CLASS
	} from './compact-row-classes';
	import PendingSyncNote from './PendingSyncNote.svelte';
	import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';

	interface Props {
		expense: Expense;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		isSelected: boolean;
		onSelect: (_id: string) => void;
		onDelete: (_expense: Expense) => void;
		pending?: PendingRowState | undefined;
	}

	let {
		expense,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		isSelected,
		onSelect,
		onDelete,
		pending
	}: Props = $props();
	let shownTags = $derived(tagsBesideCategory(expense.tags, expense.category));

	let vehicle: Vehicle | undefined = $derived(vehicleMap.get(expense.vehicleId));
	let IconComponent = $derived(getCategoryIcon(expense.category));
	let heading = $derived(rowTitle(expense.description, expense.category));
	let meta = $derived(
		[
			heading.categoryInMeta ? EXPENSE_CATEGORY_INFO[expense.category].shortLabel : null,
			showVehicleColumn && vehicle ? getVehicleDisplayName(vehicle) : null,
			formatDate(new Date(expense.date)),
			fillLabel(expense, vehicle)
		].filter(part => part !== null)
	);
</script>

{#snippet summary()}
	<IconComponent class="h-5 w-5 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
	<div class="flex-1 min-w-0">
		<p class="truncate font-medium text-foreground">
			{heading.title}
		</p>
		<p class="mt-0.5 text-sm text-muted-foreground">
			{meta.join(' · ')}
		</p>
		{#if expense.sourceType === 'reminder'}
			<div class="mt-1.5">
				<RecurringExpenseBadge />
			</div>
		{/if}
		{#if shownTags.length > 0}
			<div class="flex flex-wrap gap-1 mt-1.5">
				{#each shownTags as tag (tag)}
					<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
				{/each}
			</div>
		{/if}
	</div>
	<span class="self-center whitespace-nowrap font-semibold tabular-nums text-foreground">
		{formatCurrency(expense.amount)}
	</span>
{/snippet}

<div
	data-testid="expense-row"
	class="transition-colors {isSelected ? 'bg-muted/50' : ''} {pending
		? 'motion-safe:animate-[row-arrive_200ms_ease-out]'
		: ''}"
>
	{#if canWrite && !pending}
		<!-- A button cannot contain interactive content, so actions sit beside the summary, not inside it. -->
		<button
			type="button"
			class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
			aria-expanded={isSelected}
			onclick={() => onSelect(expense.id)}
		>
			{@render summary()}
		</button>
	{:else}
		<div class={MOBILE_ROW_SUMMARY_CLASS}>
			{@render summary()}
		</div>
	{/if}
	{#if pending}
		<div class="pr-3 pb-3 pl-[2.75rem]">
			<PendingSyncNote
				{pending}
				entryId={expense.id}
				{returnTo}
				label="{formatCurrency(expense.amount)} {heading.title}"
			/>
		</div>
	{/if}
	{#if isSelected && canWrite && !pending}
		<div class={MOBILE_ROW_ACTIONS_CONTAINER_CLASS}>
			<Button
				variant="ghost"
				size="sm"
				class={MOBILE_ROW_ACTION_CLASS}
				href={expenseEditHref(expense.id, returnTo)}
			>
				<Pencil class="h-3.5 w-3.5 mr-1" />
				Edit
			</Button>
			{#if canDelete}
				<Button
					variant="ghost"
					size="sm"
					class="{MOBILE_ROW_ACTION_CLASS} text-destructive hover:text-destructive hover:bg-destructive/10"
					onclick={() => onDelete(expense)}
				>
					<Trash2 class="h-3.5 w-3.5 mr-1" />
					Delete
				</Button>
			{/if}
		</div>
	{/if}
</div>
