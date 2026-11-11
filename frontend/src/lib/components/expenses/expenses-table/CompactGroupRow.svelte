<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import SplitExpenseBadge from '../split/SplitExpenseBadge.svelte';
	import type { Vehicle } from '$lib/types';
	import { formatCurrency, formatDate } from '$lib/utils/formatters';
	import {
		categoryLabels,
		getCategoryBadgeClasses,
		getCategoryIcon
	} from '$lib/utils/expense-helpers';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
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
	import type { GroupRow } from './expense-table-rows';

	interface Props {
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
		onDelete
	}: Props = $props();

	let IconComponent = $derived(getCategoryIcon(row.category));
	let insuranceLinked = $derived(isInsuranceLinked(row.tags));
	let blockedId = $derived(blockedReasonId(row.groupId));
</script>

<div class="transition-colors {isSelected ? 'bg-muted/50' : ''}">
	<!-- Group parent row: the per-vehicle portions are always revealable, so this is always a control. -->
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
					{categoryLabels[row.category]}
				</p>
				<span class="text-sm font-semibold text-foreground whitespace-nowrap flex-shrink-0">
					{formatCurrency(row.totalAmount)}
				</span>
			</div>
			<div class="flex items-center flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground">
				<SplitExpenseBadge />
				<span>·</span>
				<span>{formatDate(new Date(row.date))}</span>
				{#if showVehicleColumn && row.vehicleNames.length > 0}
					<span>·</span>
					<span class="truncate">{row.vehicleNames.join(', ')}</span>
				{/if}
			</div>
			{#if row.tags && row.tags.length > 0}
				<div class="flex flex-wrap gap-1 mt-1.5">
					{#each row.tags as tag (tag)}
						<Badge variant="secondary" class="font-normal text-xs px-1.5 py-0">{tag}</Badge>
					{/each}
				</div>
			{/if}
		</div>
	</button>
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
