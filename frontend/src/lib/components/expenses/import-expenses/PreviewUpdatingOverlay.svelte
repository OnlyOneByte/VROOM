<script lang="ts" module>
	export const PREVIEW_UPDATING_LABEL = 'Updating…';
</script>

<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
</script>

<div class="absolute inset-0 rounded-lg bg-card/70" aria-hidden="true">
	<span
		class="absolute -top-2.5 right-3 flex items-center gap-1.5 rounded-full border bg-card px-2 text-xs text-muted-foreground"
		data-testid="preview-updating"
	>
		<LoaderCircle class="h-3 w-3 animate-spin" />
		{PREVIEW_UPDATING_LABEL}
	</span>
</div>
