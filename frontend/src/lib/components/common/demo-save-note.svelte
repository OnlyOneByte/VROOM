<script lang="ts" module>
	export const DEMO_SAVE_NOTE_ID = 'demo-save-note';
</script>

<script lang="ts">
	import { cn } from '#lib/utils.ts';

	interface Props {
		class?: string;
		id?: string | null;
	}

	let { class: className, id = DEMO_SAVE_NOTE_ID }: Props = $props();
</script>

<p
	id={id ?? undefined}
	data-slot="demo-save-note"
	class={cn('basis-full text-sm text-muted-foreground', className)}
>
	Saving is off in the demo garage.
</p>
