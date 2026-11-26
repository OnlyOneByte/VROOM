<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';

	interface Props {
		isSubmitting: boolean;
		onCancel: () => void;
	}

	let { isSubmitting, onCancel }: Props = $props();

	function keepFieldFocus(event: MouseEvent) {
		event.preventDefault();
	}
</script>

<div
	class="sticky bottom-0 z-10 -mx-4 flex flex-col items-center gap-1 bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-transparent sm:p-0"
>
	<Button
		type="submit"
		onmousedown={keepFieldFocus}
		disabled={isSubmitting}
		class="h-12 w-full rounded-full text-base"
	>
		{#if isSubmitting}
			<LoaderCircle class="h-5 w-5 animate-spin" />
			Saving...
		{:else}
			Save Expense
		{/if}
	</Button>
	<Button
		type="button"
		variant="link"
		onmousedown={keepFieldFocus}
		onclick={onCancel}
		disabled={isSubmitting}
		class="h-11 px-4 font-semibold text-accent-ink"
	>
		Cancel
	</Button>
</div>
