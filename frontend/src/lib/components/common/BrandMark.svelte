<script lang="ts">
	import { Car } from '@lucide/svelte';
	import { cn } from '#lib/utils.js';

	let { class: className }: { class?: string } = $props();
</script>

<Car class={cn('h-6 w-6 shrink-0 text-primary', className)} aria-hidden="true" data-brand-mark />
