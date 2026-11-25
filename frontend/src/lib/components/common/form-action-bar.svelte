<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div
	data-slot="form-action-bar"
	class="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:px-0 lg:pt-6 lg:pb-0 short:static short:mx-0 short:px-0 short:pt-6 short:pb-0"
>
	{@render children()}
</div>
