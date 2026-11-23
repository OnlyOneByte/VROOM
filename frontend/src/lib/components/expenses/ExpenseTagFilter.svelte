<script lang="ts">
	import { Tag, X } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';

	interface Props {
		allTags: string[];
		selectedTags: string[];
		onTagsChange: (_tags: string[]) => void;
	}

	let { allTags, selectedTags, onTagsChange }: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-tag-suggestions`;

	let tagSearchTerm = $state('');
	let tagSearchFocused = $state(false);
	let activeIndex = $state(-1);

	let tagSuggestions = $derived.by(() => {
		if (!tagSearchTerm.trim()) return allTags.filter(t => !selectedTags.includes(t));
		const term = tagSearchTerm.toLowerCase();
		return allTags.filter(t => !selectedTags.includes(t) && t.toLowerCase().includes(term));
	});
	let visibleSuggestions = $derived(tagSuggestions.slice(0, 8));
	let listOpen = $derived(tagSearchFocused && visibleSuggestions.length > 0);
	let activeSuggestion = $derived(listOpen ? visibleSuggestions[activeIndex] : undefined);

	$effect(() => {
		if (activeSuggestion) {
			document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
		}
	});

	function addTag(tag: string): void {
		if (!selectedTags.includes(tag)) {
			onTagsChange([...selectedTags, tag]);
		}
		tagSearchTerm = '';
		activeIndex = -1;
	}

	function removeTag(tag: string): void {
		onTagsChange(selectedTags.filter(t => t !== tag));
	}

	function moveActive(step: number): void {
		tagSearchFocused = true;
		const count = visibleSuggestions.length;
		if (count === 0) return;
		activeIndex =
			step > 0 ? (activeIndex + 1) % count : activeIndex <= 0 ? count - 1 : activeIndex - 1;
	}

	function handleTagKeydown(e: KeyboardEvent): void {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			moveActive(e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const exactMatch = allTags.find(
				t => !selectedTags.includes(t) && t.toLowerCase() === tagSearchTerm.trim().toLowerCase()
			);
			const pick = activeSuggestion ?? exactMatch ?? tagSuggestions[0];
			if (pick) addTag(pick);
		} else if (e.key === 'Backspace' && !tagSearchTerm && selectedTags.length > 0) {
			const lastTag = selectedTags[selectedTags.length - 1];
			if (lastTag) removeTag(lastTag);
		} else if (e.key === 'Escape' && listOpen) {
			e.preventDefault();
			e.stopPropagation();
			tagSearchFocused = false;
			activeIndex = -1;
		}
	}

	function handleFocusOut(e: FocusEvent & { currentTarget: HTMLElement }): void {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
			tagSearchFocused = false;
			activeIndex = -1;
		}
	}
</script>

<div class="space-y-2" onfocusout={handleFocusOut}>
	<div class="flex items-center justify-between">
		<p class="text-sm font-medium text-muted-foreground">Tags</p>
		{#if selectedTags.length > 1}
			<p class="text-xs text-muted-foreground">Matching all selected tags</p>
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
						bind:value={tagSearchTerm}
						oninput={() => {
							tagSearchFocused = true;
							activeIndex = -1;
						}}
						onkeydown={handleTagKeydown}
						onfocus={() => (tagSearchFocused = true)}
						placeholder={selectedTags.length > 0 ? 'Add more tags...' : 'Search and add tags...'}
						class="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
						aria-label="Search tags"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={listOpen}
						aria-controls={listOpen ? listId : undefined}
						aria-activedescendant={activeSuggestion ? `${listId}-${activeIndex}` : undefined}
					/>
				</div>
			</div>
		</div>

		{#if listOpen}
			<div
				id={listId}
				role="listbox"
				aria-label="Tag suggestions"
				tabindex="-1"
				class="absolute z-50 left-0 right-0 mt-1 border border-border rounded-lg shadow-lg bg-popover max-h-48 overflow-y-auto"
			>
				{#each visibleSuggestions as suggestion, i (suggestion)}
					<button
						id="{listId}-{i}"
						type="button"
						role="option"
						tabindex="-1"
						aria-selected={i === activeIndex}
						onmousedown={e => e.preventDefault()}
						onclick={() => addTag(suggestion)}
						class="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
					>
						<Tag class="h-3.5 w-3.5 text-muted-foreground" />
						{suggestion}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
