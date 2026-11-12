<script lang="ts">
	import Input from '#lib/components/ui/input/input.svelte';
	import Label from '#lib/components/ui/label/label.svelte';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import TagInput from '../TagInput.svelte';

	interface Props {
		description: string;
		location: string;
		tags: string[];
		tagError?: string;
		tagTouched?: boolean;
		tagSuggestions: string[];
	}

	let {
		description = $bindable(),
		location = $bindable(),
		tags = $bindable(),
		tagError,
		tagTouched,
		tagSuggestions
	}: Props = $props();
</script>

<div class="space-y-2">
	<Label for="description">Description (Optional)</Label>
	<Textarea
		id="description"
		bind:value={description}
		rows={3}
		placeholder="Add any additional notes..."
		class="bg-background"
	/>
</div>

<div class="space-y-2">
	<Label for="location">Location (Optional)</Label>
	<Input
		id="location"
		bind:value={location}
		placeholder="e.g. Shell, Main St"
		class="bg-background"
	/>
</div>

<TagInput bind:tags error={tagError} touched={tagTouched} suggestions={tagSuggestions} />
