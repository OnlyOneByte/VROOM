<script lang="ts" module>
	export const DEMO_SAVE_NOTE_ID = 'demo-save-note';
</script>

<script lang="ts">
	import { cn } from '#lib/utils.ts';

	interface Props {
		class?: string;
	}

	let { class: className }: Props = $props();
</script>

<p
	id={DEMO_SAVE_NOTE_ID}
	data-slot="demo-save-note"
	class={cn('basis-full text-sm text-muted-foreground', className)}
>
	Saving is off in the demo garage.
</p>
