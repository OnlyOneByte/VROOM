<script lang="ts">
	import { Tag, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		allTags: string[];
		selectedTags: string[];
		tagMatchMode: 'any' | 'all';
		onTagsChange: (_tags: string[]) => void;
		onMatchModeChange: (_mode: 'any' | 'all') => void;
	}

	let { allTags, selectedTags, tagMatchMode, onTagsChange, onMatchModeChange }: Props = $props();

	// Internal state
	let tagSearchTerm = $state('');
	let tagSearchFocused = $state(false);
	let tagInputEl = $state<HTMLInputElement | null>(null);

	let tagSuggestions = $derived.by(() => {
		if (!tagSearchTerm.trim()) return allTags.filter(t => !selectedTags.includes(t));
		const term = tagSearchTerm.toLowerCase();
		return allTags.filter(t => !selectedTags.includes(t) && t.toLowerCase().includes(term));
	});

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			onTagsChange([...selectedTags, tag]);
		}
		tagSearchTerm = '';
		tagSearchFocused = true;
		tagInputEl?.focus();
	}

	function removeTag(tag: string): void {
		onTagsChange(selectedTags.filter(t => t !== tag));
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
					onclick={() => {
						onMatchModeChange('any');
					}}
				>
					Any
				</button>
				<button
					role="radio"
					aria-checked={tagMatchMode === 'all'}
					class="px-2.5 py-1 rounded-r-md transition-colors {tagMatchMode === 'all'
						? 'bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:bg-muted'}"
					onclick={() => {
						onMatchModeChange('all');
					}}
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
				{#each selectedTags as tag (tag)}
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
						placeholder={selectedTags.length > 0 ? 'Add more tags...' : 'Search and add tags...'}
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
				{#each tagSuggestions.slice(0, 8) as suggestion (suggestion)}
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
