<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import DemoSaveNote, { DEMO_SAVE_NOTE_ID } from '#lib/components/common/demo-save-note.svelte';
	import { authStore } from '#lib/stores/auth.svelte.ts';

	interface Props {
		isSubmitting: boolean;
		onCancel: () => void;
		quick?: boolean;
		edit?: boolean;
		disabled?: boolean;
	}

	let { isSubmitting, onCancel, quick = false, edit = false, disabled = false }: Props = $props();
	const demo = $derived(authStore.user?.demo === true);

	function keepFieldFocus(event: MouseEvent) {
		event.preventDefault();
	}
</script>

{#snippet saveLabel()}
	{#if isSubmitting}
		<LoaderCircle class="h-5 w-5 animate-spin" />
		Saving...
	{:else}
		{edit ? 'Save changes' : 'Save Expense'}
	{/if}
{/snippet}

{#if quick}
	<div
		class="sticky bottom-0 z-10 -mx-4 flex flex-col items-center gap-1 bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:bg-transparent sm:p-0"
	>
		{#if demo}
			<DemoSaveNote class="text-center" />
		{/if}
		<Button
			type="submit"
			onmousedown={keepFieldFocus}
			disabled={isSubmitting}
			aria-disabled={demo || undefined}
			aria-describedby={demo ? DEMO_SAVE_NOTE_ID : undefined}
			class="h-12 w-full rounded-full text-base"
		>
			{@render saveLabel()}
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
{:else}
	<div
		class="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-3 bg-background px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:p-0"
	>
		<Button
			type="button"
			onmousedown={keepFieldFocus}
			variant="outline"
			onclick={onCancel}
			disabled={isSubmitting || disabled}
			class="hidden h-10 px-5 sm:inline-flex"
		>
			Cancel
		</Button>
		<Button
			type="submit"
			onmousedown={keepFieldFocus}
			disabled={isSubmitting || disabled}
			aria-disabled={demo || undefined}
			aria-describedby={demo ? DEMO_SAVE_NOTE_ID : undefined}
			class="h-12 w-full text-base sm:h-10 sm:w-auto sm:px-5 sm:text-sm"
		>
			{@render saveLabel()}
		</Button>
		{#if demo}
			<DemoSaveNote class="text-center sm:order-first sm:mr-auto sm:basis-auto sm:self-center" />
		{/if}
	</div>
{/if}
