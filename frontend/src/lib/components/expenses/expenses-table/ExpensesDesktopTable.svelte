<script lang="ts">
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import type { Expense, Vehicle } from '$lib/types';
	import ExpenseCategoryFilter from './ExpenseCategoryFilter.svelte';
	import ExpenseSortButton from './ExpenseSortButton.svelte';
	import DesktopStandaloneRow from './DesktopStandaloneRow.svelte';
	import DesktopGroupRow from './DesktopGroupRow.svelte';
	import { rowKey, type DisplayRow, type GroupRow, type SortField } from './expense-table-rows';

	interface Props {
		rows: DisplayRow[];
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		scrollHeight: string;
		categoryFilter: string;
		sortBy: SortField;
		expandedGroups: ReadonlySet<string>;
		onToggleGroup: (_groupId: string) => void;
		onSort: (_field: SortField) => void;
		onCategoryChange: (_category: string) => void;
		onDeleteExpense: (_expense: Expense) => void;
		onDeleteGroup: (_row: GroupRow) => void;
	}

	let {
		rows,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		scrollHeight,
		categoryFilter,
		sortBy,
		expandedGroups,
		onToggleGroup,
		onSort,
		onCategoryChange,
		onDeleteExpense,
		onDeleteGroup
	}: Props = $props();
</script>

<div class="rounded-md border bg-card overflow-hidden">
	<!-- Tailwind cannot generate classes from a runtime value, so the height stays an inline style. -->
	<ScrollArea class="w-full" style="height: {scrollHeight}">
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead class="whitespace-nowrap">
						<ExpenseSortButton
							label="Date"
							field="date"
							{sortBy}
							{onSort}
							class="h-8 px-2 -ml-2 hover:bg-muted"
							iconClass="ml-1 h-3.5 w-3.5"
						/>
					</TableHead>
					{#if showVehicleColumn}
						<TableHead class="whitespace-nowrap">Vehicle</TableHead>
					{/if}
					<TableHead class="whitespace-nowrap">
						<ExpenseCategoryFilter
							density="table"
							value={categoryFilter}
							onChange={onCategoryChange}
						/>
					</TableHead>
					<TableHead>Tags</TableHead>
					<TableHead class="w-full min-w-[100px]">Description</TableHead>
					<TableHead class="text-right whitespace-nowrap">
						<ExpenseSortButton
							label="Amount"
							field="amount"
							{sortBy}
							{onSort}
							class="h-8 px-2 -mr-2 ml-auto hover:bg-muted"
							iconClass="ml-1 h-3.5 w-3.5"
						/>
					</TableHead>
					<TableHead class="text-right whitespace-nowrap">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{#if rows.length === 0}
					<TableRow>
						<TableCell colspan={showVehicleColumn ? 7 : 6} class="h-24 text-center">
							<p class="text-muted-foreground">No expenses match this category filter.</p>
						</TableCell>
					</TableRow>
				{:else}
					{#each rows as row (rowKey(row))}
						{#if row.type === 'standalone'}
							<DesktopStandaloneRow
								expense={row.expense}
								{vehicleMap}
								{showVehicleColumn}
								{canWrite}
								{canDelete}
								{returnTo}
								onDelete={onDeleteExpense}
							/>
						{:else}
							<DesktopGroupRow
								{row}
								{vehicleMap}
								{showVehicleColumn}
								{canWrite}
								{canDelete}
								{returnTo}
								isExpanded={expandedGroups.has(row.groupId)}
								onToggle={onToggleGroup}
								onDelete={onDeleteGroup}
							/>
						{/if}
					{/each}
				{/if}
			</TableBody>
		</Table>
	</ScrollArea>
</div>
