<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import SplitExpenseBadge from '../split/SplitExpenseBadge.svelte';
	import type { Vehicle } from '#lib/types/index.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getCategoryBadgeClasses, getCategoryIcon } from '#lib/utils/expense-helpers.ts';
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
	import { rowTitle, tagsBesideCategory, type GroupRow } from './expense-table-rows';
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
		pending
	}: Props = $props();
	let shownTags = $derived(tagsBesideCategory(row.tags, row.category));

	let IconComponent = $derived(getCategoryIcon(row.category));
	let heading = $derived(rowTitle(row.description, row.category));
	let insuranceLinked = $derived(isInsuranceLinked(row.tags));
	let blockedId = $derived(blockedReasonId(row.groupId));
</script>

<div class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
	<button
		type="button"
		class="{MOBILE_ROW_SUMMARY_CLASS} cursor-pointer"
		aria-expanded={isSelected}
		onclick={() => onSelect(row.groupId)}
	>
		<div class="mt-0.5 p-1.5 rounded-lg {getCategoryBadgeClasses(row.category)} flex-shrink-0">
			<IconComponent class="h-4 w-4" />
		</div>
		<div class="flex-1 min-w-0">
			<div class="flex items-center justify-between gap-2">
				<p class="text-sm font-medium text-foreground truncate">
					{heading.title}
				</p>
				<span class="text-sm font-semibold text-foreground whitespace-nowrap flex-shrink-0">
					{formatCurrency(row.totalAmount)}
				</span>
			</div>
			<div class="flex min-w-0 items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
				<SplitExpenseBadge />
				{#if heading.categoryInMeta}
					<span>·</span>
					<span class="shrink-0">{EXPENSE_CATEGORY_INFO[row.category].shortLabel}</span>
				{/if}
				<span>·</span>
				<span class="shrink-0 whitespace-nowrap">{formatDate(new Date(row.date))}</span>
				{#if showVehicleColumn && row.vehicleNames.length > 0}
					<span>·</span>
					<span class="min-w-0 truncate">{row.vehicleNames.join(', ')}</span>
				{/if}
			</div>
			{#if shownTags.length > 0}
				<div class="flex flex-wrap gap-1 mt-1.5">
					{#each shownTags as tag (tag)}
						<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
					{/each}
				</div>
			{/if}
		</div>
	</button>
	{#if pending}
		<div class="pr-3 pb-3 pl-[3.25rem]">
			<PendingSyncNote
				{pending}
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
