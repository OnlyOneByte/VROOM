<script lang="ts">
	import { Search, X, Car, Tag } from 'lucide-svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as CardNs from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import DateRangePicker from '$lib/components/common/date-range-picker.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { extractUniqueTags } from '$lib/utils/expense-filters';
	import { COMMON_MESSAGES } from '$lib/constants/messages';
	import type { Vehicle, Expense, ExpenseFilters } from '$lib/types';

	interface Props {
		searchTerm: string;
		filters: ExpenseFilters;
		expenses: Expense[];
		vehicles?: Vehicle[];
		showVehicleSelector?: boolean;
		selectedVehicleId?: string | undefined;
		onSearchChange: (_value: string) => void;
		onVehicleChange?: (_vehicleId: string | undefined) => void;
		onClearFilters: () => void;
	}

	let {
		searchTerm,
		filters = $bindable(),
		expenses,
		vehicles = [],
		showVehicleSelector = false,
		selectedVehicleId = undefined,
		onSearchChange,
		onVehicleChange,
		onClearFilters
	}: Props = $props();

	// Tag filter state
	let selectedTags = $state<string[]>([]);
	let tagMatchMode = $state<'any' | 'all'>('any');
	let tagSearchTerm = $state('');
	let tagSearchFocused = $state(false);
	let tagInputEl = $state<HTMLInputElement | null>(null);

	// Get all unique tags from expenses
	let allTags = $derived(extractUniqueTags(expenses));

	// Filtered tag suggestions
	let tagSuggestions = $derived.by(() => {
		if (!tagSearchTerm.trim()) return allTags.filter(t => !selectedTags.includes(t));
		const term = tagSearchTerm.toLowerCase();
		return allTags.filter(t => !selectedTags.includes(t) && t.toLowerCase().includes(term));
	});

	// Check if any filters are active
	let hasActiveFilters = $derived(
		!!searchTerm ||
			!!selectedVehicleId ||
			selectedTags.length > 0 ||
			!!filters.category ||
			!!filters.startDate ||
			!!filters.endDate
	);

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			selectedTags = [...selectedTags, tag];
			filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
		}
		tagSearchTerm = '';
		tagSearchFocused = true;
		tagInputEl?.focus();
	}

	function removeTag(tag: string): void {
		selectedTags = selectedTags.filter(t => t !== tag);
		filters = { ...filters, tags: selectedTags.length > 0 ? selectedTags : undefined };
	}

	function handleTagKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			const exactMatch = allTags.find(
				t => !selectedTags.includes(t) && t.toLowerCase() === tagSearchTerm.trim().toLowerCase()
			);
			if (exactMatch) {
				addTag(exactMatch);
			} else if (tagSuggestions.length > 0) {
				const firstSuggestion = tagSuggestions[0];
				if (firstSuggestion) addTag(firstSuggestion);
			}
		} else if (e.key === 'Backspace' && !tagSearchTerm && selectedTags.length > 0) {
			const lastTag = selectedTags[selectedTags.length - 1];
			if (lastTag) removeTag(lastTag);
		} else if (e.key === 'Escape') {
			tagSearchFocused = false;
			tagInputEl?.blur();
		}
	}
</script>

<CardNs.Root>
	<CardNs.Header>
		<div class="flex items-center justify-between gap-3">
			<div>
				<CardNs.Title>Search & Filters</CardNs.Title>
				<CardNs.Description>Find and filter your expenses</CardNs.Description>
			</div>
			<div class="flex items-center gap-2">
				<DateRangePicker
					bind:startValue={filters.startDate}
					bind:endValue={filters.endDate}
					placeholder="Date range"
					class="w-auto"
				/>
			</div>
		</div>
	</CardNs.Header>
	<CardNs.Content class="space-y-4">
		<!-- Search Bar + Vehicle/Category Selector Row -->
		<div class="flex flex-col sm:flex-row gap-3">
			<div class="flex-1 relative">
				<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
					<Search class="h-5 w-5 text-muted-foreground" />
				</div>
				<Input
					type="text"
					value={searchTerm}
					oninput={e => onSearchChange(e.currentTarget.value)}
					placeholder="Search expenses..."
					class="pl-10 w-full"
					aria-label="Search expenses"
				/>
			</div>
			{#if showVehicleSelector && vehicles.length > 0}
				<div class="sm:w-56">
					<Select.Root
						type="single"
						value={selectedVehicleId ?? ''}
						onValueChange={v => onVehicleChange?.(v === '' ? undefined : v)}
					>
						<Select.Trigger class="w-full">
							<div class="flex items-center gap-2">
								<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
								<span class="truncate">
									{#if selectedVehicleId}
										{@const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId)}
										{selectedVehicle
											? getVehicleDisplayName(selectedVehicle)
											: COMMON_MESSAGES.ALL_VEHICLES}
									{:else}
										{COMMON_MESSAGES.ALL_VEHICLES}
									{/if}
								</span>
							</div>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label={COMMON_MESSAGES.ALL_VEHICLES}
								>{COMMON_MESSAGES.ALL_VEHICLES}</Select.Item
							>
							{#each vehicles as vehicle (vehicle.id)}
								<Select.Item value={vehicle.id} label={getVehicleDisplayName(vehicle)}>
									{getVehicleDisplayName(vehicle)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
		</div>

		<!-- Tag Search Input -->
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<p class="text-sm font-medium text-muted-foreground">Tags</p>
				{#if selectedTags.length > 1}
					<div
						class="flex items-center rounded-md border text-xs"
						role="radiogroup"
						aria-label="Tag match mode"
					>
						<button
							role="radio"
							aria-checked={tagMatchMode === 'any'}
							class="px-2.5 py-1 rounded-l-md transition-colors {tagMatchMode === 'any'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:bg-muted'}"
							onclick={() => (tagMatchMode = 'any')}
						>
							Any
						</button>
						<button
							role="radio"
							aria-checked={tagMatchMode === 'all'}
							class="px-2.5 py-1 rounded-r-md transition-colors {tagMatchMode === 'all'
								? 'bg-primary text-primary-foreground'
								: 'text-muted-foreground hover:bg-muted'}"
							onclick={() => (tagMatchMode = 'all')}
						>
							All
						</button>
					</div>
				{/if}
			</div>
			<div class="relative">
				<div
					class="border rounded-lg p-2 min-h-[42px] bg-background border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background"
				>
					<div class="flex flex-wrap gap-1.5 items-center">
						{#each selectedTags as tag}
							<Badge variant="secondary" class="gap-1 pr-1">
								{tag}
								<button
									type="button"
									onclick={() => removeTag(tag)}
									class="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
									aria-label="Remove tag {tag}"
								>
									<X class="h-3 w-3" />
								</button>
							</Badge>
						{/each}
						<div class="flex items-center gap-1.5 flex-1 min-w-[120px]">
							<Tag class="h-4 w-4 text-muted-foreground flex-shrink-0" />
							<input
								bind:this={tagInputEl}
								bind:value={tagSearchTerm}
								onkeydown={handleTagKeydown}
								onfocus={() => (tagSearchFocused = true)}
								onblur={() => setTimeout(() => (tagSearchFocused = false), 200)}
								placeholder={selectedTags.length > 0
									? 'Add more tags...'
									: 'Search and add tags...'}
								class="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
								aria-label="Search tags"
							/>
						</div>
					</div>
				</div>

				{#if tagSearchFocused && tagSuggestions.length > 0}
					<div
						class="absolute z-50 left-0 right-0 mt-1 border border-border rounded-lg shadow-lg bg-popover max-h-48 overflow-y-auto"
					>
						{#each tagSuggestions.slice(0, 8) as suggestion}
							<button
								type="button"
								onclick={() => addTag(suggestion)}
								class="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent text-sm"
							>
								<Tag class="h-3.5 w-3.5 text-muted-foreground" />
								{suggestion}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Clear Filters -->
		{#if hasActiveFilters}
			<div class="flex justify-end pt-2">
				<Button variant="outline" size="sm" onclick={onClearFilters}>
					<X class="h-4 w-4 mr-2" />
					{COMMON_MESSAGES.CLEAR_FILTERS}
				</Button>
			</div>
		{/if}
	</CardNs.Content>
</CardNs.Root>
