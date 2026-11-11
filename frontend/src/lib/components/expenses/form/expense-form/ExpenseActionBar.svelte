<script lang="ts">
	import { Check, Copy, LoaderCircle, Trash2, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		isEditMode: boolean;
		canDuplicate: boolean;
		isSubmitting: boolean;
		isDeleting: boolean;
		onDelete: () => void;
		onDuplicate: () => void;
		onCancel: () => void;
		onSave: () => void;
	}

	let {
		isEditMode,
		canDuplicate,
		isSubmitting,
		isDeleting,
		onDelete,
		onDuplicate,
		onCancel,
		onSave
	}: Props = $props();
</script>

<div
	class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto z-50"
>
	<div
		class="flex flex-row gap-3 sm:gap-4 justify-center sm:justify-end items-center bg-background sm:bg-transparent p-3 sm:p-0 rounded-full sm:rounded-none shadow-2xl sm:shadow-none"
	>
		{#if isEditMode}
			<Button
				type="button"
				variant="destructive"
				onclick={onDelete}
				disabled={isDeleting || isSubmitting}
				class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 border-0 flex-shrink-0"
			>
				<Trash2 class="h-5 w-5 sm:mr-2" />
				<!-- Clip rather than hide below sm: a sr-only rule would otherwise outrank sm:not-sr-only. -->
				<span class="max-sm:sr-only font-semibold">Delete</span>
			</Button>
		{/if}

		{#if canDuplicate}
			<Button
				type="button"
				variant="outline"
				onclick={onDuplicate}
				disabled={isSubmitting || isDeleting}
				class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 flex-shrink-0"
			>
				<Copy class="h-5 w-5 sm:mr-2" />
				<span class="max-sm:sr-only font-semibold">Duplicate</span>
			</Button>
		{/if}

		<Button
			type="button"
			variant="outline"
			onclick={onCancel}
			disabled={isSubmitting || isDeleting}
			class="sm:rounded-full rounded-full shadow-lg transition-all duration-300 sm:hover:scale-105 h-14 sm:h-14 px-5 flex-shrink-0"
		>
			<X class="h-5 w-5 sm:mr-2" />
			<span class="max-sm:sr-only font-semibold">Cancel</span>
		</Button>

		<Button
			type="button"
			onclick={onSave}
			disabled={isSubmitting || isDeleting}
			class="sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 h-14 sm:h-14 px-6 border-0 flex-1 sm:flex-initial"
		>
			{#if isSubmitting}
				<LoaderCircle class="h-5 w-5 animate-spin mr-2" />
				<span class="font-bold">{isEditMode ? 'Updating' : 'Saving'}...</span>
			{:else}
				<Check class="h-5 w-5 mr-2 transition-transform duration-300 group-hover:scale-110" />
				<span class="font-bold">{isEditMode ? 'Update' : 'Save'} Expense</span>
			{/if}
		</Button>
	</div>
</div>
