<script lang="ts">
	import { Search, X } from '@lucide/svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import ExpenseTagFilter from '#lib/components/expenses/ExpenseTagFilter.svelte';
	import DateRangePicker from '#lib/components/common/date-range-picker.svelte';
	import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
	import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_INFO } from '#lib/constants/expense-categories.ts';
	import { COMMON_MESSAGES } from '#lib/constants/messages.ts';
	import type { Expense, ExpenseFilters } from '#lib/types/index.ts';

	type Sort = `${'date' | 'amount'}-${'asc' | 'desc'}`;

	interface Props {
		searchTerm: string;
		filters: ExpenseFilters;
		expenses: Expense[];
		category: string;
		sort: Sort;
		onSearchChange: (_value: string) => void;
		onCategoryChange: (_category: string) => void;
		onSortChange: (_sort: Sort) => void;
		onClearFilters: () => void;
	}

	let {
		searchTerm,
		filters = $bindable(),
		expenses,
		category,
		sort,
		onSearchChange,
		onCategoryChange,
		onSortChange,
		onClearFilters
	}: Props = $props();

	const SORTS: Record<Sort, string> = {
		'date-desc': 'Newest first',
		'date-asc': 'Oldest first',
		'amount-desc': 'Largest first',
		'amount-asc': 'Smallest first'
	};

	let selectedTags = $derived(filters.tags ?? []);
	let allTags = $derived(extractUniqueTags(expenses));

	let hasActiveFilters = $derived(
		!!searchTerm ||
			selectedTags.length > 0 ||
			!!category ||
			!!filters.startDate ||
			!!filters.endDate
	);

	function setTags(tags: string[]): void {
		filters = { ...filters, tags: tags.length > 0 ? tags : undefined };
	}

	const chip =
		'h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50';
</script>

<div class="space-y-3" role="search" aria-label="Find expenses">
	<div class="relative">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<Search class="h-5 w-5 text-muted-foreground" />
		</div>
		<Input
			type="text"
			value={searchTerm}
			oninput={e => onSearchChange(e.currentTarget.value)}
			placeholder="Search “Costco”, “tires” or “42.50”"
			class="h-12 w-full pl-10 sm:h-11"
			aria-label="Search expenses"
		/>
	</div>

	<div class="flex flex-wrap gap-2" role="group" aria-label="Category">
		{#each ['', ...EXPENSE_CATEGORIES] as value (value)}
			<button
				type="button"
				class="{chip} {category === value
					? 'border-foreground bg-foreground text-background'
					: 'border-border bg-card text-foreground'}"
				aria-pressed={category === value}
				onclick={() => onCategoryChange(value)}
			>
				{value
					? EXPENSE_CATEGORY_INFO[value as keyof typeof EXPENSE_CATEGORY_INFO].shortLabel
					: 'All'}
			</button>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<DateRangePicker
			bind:startValue={filters.startDate}
			bind:endValue={filters.endDate}
			placeholder="Any date"
			class="w-auto"
		/>
		<Select.Root type="single" value={sort} onValueChange={v => v && onSortChange(v as Sort)}>
			<Select.Trigger aria-label="Sort expenses" class="w-auto">{SORTS[sort]}</Select.Trigger>
			<Select.Content>
				{#each Object.entries(SORTS) as [value, label] (value)}
					<Select.Item {value} {label}>{label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
		{#if hasActiveFilters}
			<Button variant="ghost" size="sm" onclick={onClearFilters}>
				<X class="mr-1 h-4 w-4" />
				{COMMON_MESSAGES.CLEAR_FILTERS}
			</Button>
		{/if}
	</div>

	<ExpenseTagFilter {allTags} {selectedTags} onTagsChange={setTags} />
</div>
