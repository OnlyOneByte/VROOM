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
	class="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-3 bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:p-0"
>
	<Button
		type="button"
		onmousedown={keepFieldFocus}
		variant="outline"
		onclick={onCancel}
		disabled={isSubmitting}
		class="hidden h-10 px-5 sm:inline-flex"
	>
		Cancel
	</Button>
	<Button
		type="submit"
		onmousedown={keepFieldFocus}
		disabled={isSubmitting}
		class="h-12 w-full text-base sm:h-10 sm:w-auto sm:px-5 sm:text-sm"
	>
		{#if isSubmitting}
			<LoaderCircle class="h-5 w-5 animate-spin" />
			Saving...
		{:else}
			Save Expense
		{/if}
	</Button>
</div>
