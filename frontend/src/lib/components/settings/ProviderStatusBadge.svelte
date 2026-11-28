<script lang="ts">
	import { CircleAlert, CircleCheck, CircleDashed, CircleMinus, CircleX } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import type { ProviderHealthCode, ProviderStatus } from '#lib/types/index.ts';

	let {
		status,
		lastCheckedAt,
		lastErrorCode
	}: {
		status: ProviderStatus;
		lastCheckedAt?: string | null;
		lastErrorCode?: ProviderHealthCode | null;
	} = $props();

	const LOOK = {
		active: { label: 'Connected', icon: CircleCheck, tone: 'text-success' },
		needs_reauth: { label: 'Needs reconnecting', icon: CircleAlert, tone: 'text-warning' },
		error: { label: 'Not working', icon: CircleX, tone: 'text-destructive' },
		disabled: { label: 'Turned off', icon: CircleMinus, tone: 'text-muted-foreground' }
	} as const;

	const ADDED = { label: 'Added', icon: CircleDashed, tone: 'text-muted-foreground' } as const;
	const CHECK_FAILED = { label: 'Check failed', icon: CircleAlert, tone: 'text-warning' } as const;

	let look = $derived.by(() => {
		if (status === 'active' && lastErrorCode) return CHECK_FAILED;
		if (status === 'active' && !lastCheckedAt) return ADDED;
		return LOOK[status] ?? { label: status, icon: CircleMinus, tone: 'text-muted-foreground' };
	});
</script>

<Badge variant="outline" class="shrink-0 text-xs {look.tone}">
	<look.icon aria-hidden="true" />
	{look.label}
</Badge>
