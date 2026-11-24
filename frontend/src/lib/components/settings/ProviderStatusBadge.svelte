<script lang="ts">
	import { CircleAlert, CircleCheck, CircleMinus, CircleX } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import type { ProviderStatus } from '#lib/types/index.ts';

	let { status }: { status: ProviderStatus } = $props();

	const LOOK = {
		active: { label: 'Connected', icon: CircleCheck, tone: 'text-success' },
		needs_reauth: { label: 'Needs reconnecting', icon: CircleAlert, tone: 'text-warning' },
		error: { label: 'Not working', icon: CircleX, tone: 'text-destructive' },
		disabled: { label: 'Turned off', icon: CircleMinus, tone: 'text-muted-foreground' }
	} as const;

	let look = $derived(
		LOOK[status] ?? { label: status, icon: CircleMinus, tone: 'text-muted-foreground' }
	);
</script>

<Badge variant="outline" class="shrink-0 text-xs {look.tone}">
	<look.icon aria-hidden="true" />
	{look.label}
</Badge>
