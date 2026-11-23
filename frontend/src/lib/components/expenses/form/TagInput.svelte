<script lang="ts">
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { COMMON_EXPENSE_TAGS } from '#lib/types/index.ts';

	interface Props {
		tags: string[];
		error?: string;
		touched?: boolean;
		suggestions?: readonly string[];
	}

	let {
		tags = $bindable(),
		error,
		touched = false,
		suggestions = COMMON_EXPENSE_TAGS
	}: Props = $props();

	const listId = 'tags-suggestions';

	let tagInput = $state('');
	let showSuggestions = $state(false);
	let activeIndex = $state(-1);

	let visibleSuggestions = $derived(
		suggestions
			.filter(tag => !tags.includes(tag) && tag.toLowerCase().includes(tagInput.toLowerCase()))
			.slice(0, 8)
	);
	let listOpen = $derived(showSuggestions && visibleSuggestions.length > 0);
	let activeSuggestion = $derived(listOpen ? visibleSuggestions[activeIndex] : undefined);

	$effect(() => {
		if (activeSuggestion) {
			document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
		}
	});

	function addTag(tag: string) {
		const trimmed = tag.trim().toLowerCase();
		if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
			tags = [...tags, trimmed];
			tagInput = '';
			activeIndex = -1;
		}
	}

	function removeTag(tag: string) {
		tags = tags.filter(t => t !== tag);
	}

	function moveActive(step: number) {
		showSuggestions = true;
		const count = visibleSuggestions.length;
		if (count === 0) return;
		activeIndex =
			step > 0 ? (activeIndex + 1) % count : activeIndex <= 0 ? count - 1 : activeIndex - 1;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			moveActive(e.key === 'ArrowDown' ? 1 : -1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (activeSuggestion) addTag(activeSuggestion);
			else if (tagInput.trim()) addTag(tagInput);
		} else if (e.key === 'Escape' && listOpen) {
			e.preventDefault();
			e.stopPropagation();
			showSuggestions = false;
			activeIndex = -1;
		} else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
			tags = tags.slice(0, -1);
		}
	}

	function handleFocusOut(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
			showSuggestions = false;
			activeIndex = -1;
		}
	}
</script>

<div class="space-y-2" onfocusout={handleFocusOut}>
	<Label for="tags">Tags (Optional)</Label>
	<div
		class="border rounded-lg p-2 min-h-[42px] bg-background has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 {touched &&
		error
			? 'border-destructive'
			: 'border-input'}"
	>
		<div class="flex flex-wrap gap-2 items-center">
			{#each tags as tag (tag)}
				<span
					class="inline-flex items-center gap-1 px-2 py-1 bg-secondary text-secondary-foreground rounded-full text-sm"
				>
					{tag}
					<button
						type="button"
						onclick={() => removeTag(tag)}
						class="relative hover:text-primary after:absolute after:-inset-3.5 after:content-['']"
						aria-label="Remove {tag} tag"
					>
						<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
							<path
								fill-rule="evenodd"
								d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
								clip-rule="evenodd"
							/>
						</svg>
					</button>
				</span>
			{/each}
			<input
				id="tags"
				type="text"
				bind:value={tagInput}
				oninput={() => {
					showSuggestions = true;
					activeIndex = -1;
				}}
				onkeydown={handleKeydown}
				onfocus={() => (showSuggestions = true)}
				placeholder={tags.length === 0 ? 'Add tags (e.g., fuel, maintenance)' : ''}
				class="flex-1 min-w-[120px] outline-none bg-transparent"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={listOpen}
				aria-controls={listOpen ? listId : undefined}
				aria-activedescendant={activeSuggestion ? `${listId}-${activeIndex}` : undefined}
				aria-describedby={touched && error ? 'tags-error' : undefined}
			/>
		</div>
	</div>

	{#if listOpen}
		<div
			id={listId}
			role="listbox"
			aria-label="Tag suggestions"
			tabindex="-1"
			class="border border-border rounded-lg shadow-lg bg-popover max-h-48 overflow-y-auto"
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
					class="flex w-full min-h-10 items-center text-left px-3 py-2 hover:bg-accent text-sm sm:min-h-0 aria-selected:bg-accent aria-selected:text-accent-foreground"
				>
					{suggestion}
				</button>
			{/each}
		</div>
	{/if}

	<p class="text-xs text-muted-foreground">
		Press Enter to add a tag, or pick a suggestion with the arrow keys or a click. Maximum 10 tags.
	</p>

	{#if touched && error}
		<FormFieldError id="tags-error">{error}</FormFieldError>
	{/if}
</div>
