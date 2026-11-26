<script lang="ts">
	import { cn } from '#lib/utils.ts';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();
</script>

<p data-slot="demo-save-note" class={cn('basis-full text-sm text-muted-foreground', className)}>
	Saving is off in the demo garage.
</p>
