<script lang="ts">
	import { FormFieldError } from '$lib/components/ui/form-field';
	import { Label } from '$lib/components/ui/label';
	import { COMMON_EXPENSE_TAGS } from '$lib/types';

	interface Props {
		tags: string[];
		error?: string;
		touched?: boolean;
	}

	let { tags = $bindable(), error, touched = false }: Props = $props();

	let tagInput = $state('');
	let showSuggestions = $state(false);

	let filteredSuggestions = $derived(
		COMMON_EXPENSE_TAGS.filter(
			tag => !tags.includes(tag) && tag.toLowerCase().includes(tagInput.toLowerCase())
		)
	);

	function addTag(tag: string) {
		const trimmed = tag.trim().toLowerCase();
		if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
			tags = [...tags, trimmed];
			tagInput = '';
		}
	}

	function removeTag(tag: string) {
		tags = tags.filter(t => t !== tag);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (tagInput.trim()) addTag(tagInput);
		} else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
			tags = tags.slice(0, -1);
		}
	}
</script>

<div class="space-y-2">
	<Label for="tags">Tags (Optional)</Label>
	<div
		class="border rounded-lg p-2 min-h-[42px] bg-white {touched && error
			? 'border-red-300'
			: 'border-gray-300'}"
	>
		<div class="flex flex-wrap gap-2 items-center">
			{#each tags as tag}
				<span
					class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
				>
					{tag}
					<button
						type="button"
						onclick={() => removeTag(tag)}
						class="hover:text-blue-900"
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
				onkeydown={handleKeydown}
				onfocus={() => (showSuggestions = true)}
				onblur={() => setTimeout(() => (showSuggestions = false), 200)}
				placeholder={tags.length === 0 ? 'Add tags (e.g., fuel, maintenance)' : ''}
				class="flex-1 min-w-[120px] outline-none bg-transparent"
				aria-describedby={touched && error ? 'tags-error' : undefined}
			/>
		</div>
	</div>

	{#if showSuggestions && filteredSuggestions.length > 0}
		<div class="border border-gray-200 rounded-lg shadow-lg bg-white max-h-48 overflow-y-auto">
			{#each filteredSuggestions.slice(0, 8) as suggestion}
				<button
					type="button"
					onclick={() => addTag(suggestion)}
					class="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
				>
					{suggestion}
				</button>
			{/each}
		</div>
	{/if}

	<p class="text-xs text-gray-500">
		Press Enter to add a tag, or click suggestions below. Maximum 10 tags.
	</p>

	{#if touched && error}
		<FormFieldError id="tags-error">{error}</FormFieldError>
	{/if}
</div>
