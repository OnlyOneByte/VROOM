<script lang="ts">
	import { Car, ChevronRight, Pencil, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { TableCell, TableRow } from '$lib/components/ui/table';
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
	import type { GroupRow } from './expense-table-rows';

	interface Props {
		row: GroupRow;
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		isExpanded: boolean;
		onToggle: (_groupId: string) => void;
		onDelete: (_row: GroupRow) => void;
	}

	let {
		row,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		isExpanded,
		onToggle,
		onDelete
	}: Props = $props();

	let IconComponent = $derived(getCategoryIcon(row.category));
	let insuranceLinked = $derived(isInsuranceLinked(row.tags));
	let blockedId = $derived(blockedReasonId(row.groupId));
</script>

<TableRow class="group cursor-pointer hover:bg-muted/50" onclick={() => onToggle(row.groupId)}>
	<TableCell class="font-medium text-muted-foreground">
		<div class="flex items-center gap-1.5">
			<Button
				variant="ghost"
				size="icon-sm"
				class="-ml-1.5 text-muted-foreground"
				aria-label="Split expense portions"
				aria-expanded={isExpanded}
				onclick={e => {
					e.stopPropagation();
					onToggle(row.groupId);
				}}
			>
				<ChevronRight
					class="h-4 w-4 transition-transform duration-200 {isExpanded ? 'rotate-90' : ''}"
				/>
			</Button>
			{formatDate(new Date(row.date))}
		</div>
	</TableCell>
	{#if showVehicleColumn}
		<TableCell>
			<div class="flex items-center gap-2">
				<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
				<span class="truncate text-sm">
					{row.vehicleNames.join(', ')}
				</span>
			</div>
		</TableCell>
	{/if}
	<TableCell>
		<div class="flex items-center gap-2">
			<div class="p-1.5 rounded-lg {getCategoryBadgeClasses(row.category)} flex-shrink-0">
				<IconComponent class="h-4 w-4" />
			</div>
			<span class="whitespace-nowrap">{categoryLabels[row.category]}</span>
		</div>
	</TableCell>
	<TableCell>
		<div class="flex flex-wrap gap-1">
			{#each row.tags as tag (tag)}
				<Badge variant="secondary" class="font-normal">{tag}</Badge>
			{/each}
		</div>
	</TableCell>
	<TableCell class="max-w-[200px]">
		<div class="truncate text-foreground">{row.description || '-'}</div>
	</TableCell>
	<TableCell class="text-right font-semibold whitespace-nowrap">
		<div class="flex items-center justify-end gap-1.5">
			{formatCurrency(row.totalAmount)}
			<SplitExpenseBadge />
		</div>
	</TableCell>
	<TableCell class="text-right">
		<div
			class="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
		>
			{#if canWrite}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8"
					href={expenseEditHref(row.children[0]?.id ?? '', returnTo)}
					aria-label="Edit split expense"
					title="Edit split expense"
					onclick={e => e.stopPropagation()}
				>
					<Pencil class="h-4 w-4" />
				</Button>
			{/if}
			{#if canDelete}
				<!-- disabled drops the control from the tab order and swallows hover, so use aria-disabled. -->
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 {insuranceLinked
						? 'cursor-not-allowed aria-disabled:pointer-events-auto'
						: 'text-destructive hover:text-destructive hover:bg-destructive/10'}"
					onclick={e => {
						e.stopPropagation();
						onDelete(row);
					}}
					aria-label="Delete expense"
					aria-disabled={insuranceLinked ? true : undefined}
					aria-describedby={insuranceLinked ? blockedId : undefined}
					title={insuranceLinked ? INSURANCE_DELETE_BLOCKED : 'Delete expense'}
				>
					<Trash2 class="h-4 w-4" />
				</Button>
				{#if insuranceLinked}
					<span id={blockedId} class="sr-only">{INSURANCE_DELETE_BLOCKED}</span>
				{/if}
			{/if}
		</div>
	</TableCell>
</TableRow>
{#if isExpanded}
	{#each row.children as child (child.id)}
		{@const childVehicle = vehicleMap.get(child.vehicleId)}
		<TableRow class="bg-muted/30">
			<TableCell class="pl-8 text-xs text-muted-foreground">
				{formatDate(new Date(child.date))}
			</TableCell>
			{#if showVehicleColumn}
				<TableCell>
					<div class="flex items-center gap-2 pl-4">
						<Car class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
						<span class="truncate text-sm text-muted-foreground">
							{childVehicle ? getVehicleDisplayName(childVehicle) : 'Unknown'}
						</span>
					</div>
				</TableCell>
			{/if}
			<TableCell></TableCell>
			<TableCell></TableCell>
			<TableCell></TableCell>
			<TableCell class="text-right text-sm text-muted-foreground whitespace-nowrap">
				{formatCurrency(child.amount)}
			</TableCell>
			<TableCell></TableCell>
		</TableRow>
	{/each}
{/if}
