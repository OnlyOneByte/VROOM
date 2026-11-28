<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import SplitExpenseBadge from '../split/SplitExpenseBadge.svelte';
	import type { Vehicle } from '#lib/types/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getCategoryIcon } from '#lib/utils/expense-helpers.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
	import {
		INSURANCE_DELETE_BLOCKED,
		blockedReasonId,
		expenseEditHref,
		isInsuranceLinked
	} from './expense-table-actions';
	import {
		MOBILE_ROW_ACTION_CLASS,
		MOBILE_ROW_ACTIONS_CONTAINER_CLASS,
		MOBILE_ROW_SUMMARY_CLASS
	} from './compact-row-classes';
	import { rowDate, rowTitle, tagsBesideCategory, type GroupRow } from './expense-table-rows';
	import PendingSyncNote from './PendingSyncNote.svelte';
	import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';

	interface Props {
		pending?: PendingRowState | undefined;
		row: GroupRow;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		isSelected: boolean;
		onSelect: (_groupId: string) => void;
		onDelete: (_row: GroupRow) => void;
		underMonth?: boolean;
	}

	let {
		row,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		isSelected,
		onSelect,
		onDelete,
		pending,
		underMonth = false
	}: Props = $props();
	let shownTags = $derived(tagsBesideCategory(row.tags, row.category));

	let IconComponent = $derived(getCategoryIcon(row.category));
	let heading = $derived(rowTitle(row.description, row.category));
	let meta = $derived(
		[
			heading.categoryInMeta ? EXPENSE_CATEGORY_INFO[row.category].label : null,
			showVehicleColumn && row.vehicleNames.length > 0 ? row.vehicleNames.join(', ') : null,
			rowDate(row.date, underMonth)
		].filter(part => part !== null)
	);
	let insuranceLinked = $derived(isInsuranceLinked(row.tags));
	let blockedId = $derived(blockedReasonId(row.groupId));
</script>

<div data-testid="expense-row" class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
	<button
		type="button"
		class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
		aria-expanded={isSelected}
		onclick={() => onSelect(row.groupId)}
	>
		<IconComponent class="h-5 w-5 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
		<div class="flex-1 min-w-0">
			<div class="flex min-w-0 items-center gap-1.5">
				<p class="truncate font-medium text-foreground">
					{heading.title}
				</p>
				<SplitExpenseBadge />
			</div>
			<p class="mt-0.5 flex flex-wrap gap-x-1 text-sm text-muted-foreground">
				{#each meta as part, i (i)}
					<span class="whitespace-nowrap">{i > 0 ? `· ${part}` : part}</span>
				{/each}
			</p>
			{#if shownTags.length > 0}
				<div class="flex flex-wrap gap-1 mt-1.5">
					{#each shownTags as tag (tag)}
						<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
					{/each}
				</div>
			{/if}
		</div>
		<span class="self-center whitespace-nowrap font-semibold tabular-nums text-foreground">
			{formatCurrency(row.totalAmount)}
		</span>
	</button>
	{#if pending}
		<div class="pr-3 pb-3 pl-[2.75rem]">
			<PendingSyncNote
				{pending}
				{canWrite}
				entryId={row.children[0]?.id ?? row.groupId}
				deleteKey={row.groupId}
				{returnTo}
				label="{formatCurrency(row.totalAmount)} {heading.title}"
			/>
		</div>
	{/if}
	{#if isSelected && canWrite}
		<div class={MOBILE_ROW_ACTIONS_CONTAINER_CLASS}>
			<Button
				variant="ghost"
				size="sm"
				class={MOBILE_ROW_ACTION_CLASS}
				href={expenseEditHref(row.children[0]?.id ?? '', returnTo)}
			>
				<Pencil class="h-3.5 w-3.5 mr-1" />
				Edit
			</Button>
			{#if canDelete}
				<Button
					variant="ghost"
					size="sm"
					class="{MOBILE_ROW_ACTION_CLASS} {insuranceLinked
						? 'cursor-not-allowed aria-disabled:pointer-events-auto'
						: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
					onclick={() => onDelete(row)}
					aria-disabled={insuranceLinked ? true : undefined}
					aria-describedby={insuranceLinked ? blockedId : undefined}
					title={insuranceLinked ? INSURANCE_DELETE_BLOCKED : 'Delete expense'}
				>
					<Trash2 class="h-3.5 w-3.5 mr-1" />
					Delete
				</Button>
				{#if insuranceLinked}
					<span id={blockedId} class="sr-only">{INSURANCE_DELETE_BLOCKED}</span>
				{/if}
			{/if}
		</div>
	{/if}
</div>
{#if isSelected}
	{#each row.children as child (child.id)}
		{@const childVehicle = vehicleMap.get(child.vehicleId)}
		<div class="flex items-center gap-3 pl-10 pr-3 py-2 bg-muted/30">
			<div class="flex-1 min-w-0">
				<div class="flex items-center justify-between gap-2">
					<span class="text-xs text-muted-foreground truncate">
						{#if showVehicleColumn && childVehicle}
							{getVehicleDisplayName(childVehicle)}
						{:else}
							{formatDate(new Date(child.date))}
						{/if}
					</span>
					<span class="text-sm text-muted-foreground whitespace-nowrap">
						{formatCurrency(child.amount)}
					</span>
				</div>
			</div>
		</div>
	{/each}
{/if}
