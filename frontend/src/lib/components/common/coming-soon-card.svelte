<script lang="ts">
	import type { Component } from 'svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';

	interface PlaceholderItem {
		icon: Component<{ class?: string }>;
		label: string;
		value?: string;
	}

	interface Props {
		icon: Component<{ class?: string }>;
		title: string;
		description: string;
		items: PlaceholderItem[];
	}

	let { icon: Icon, title, description, items }: Props = $props();
</script>

<Card>
	<CardHeader>
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Icon class="h-5 w-5 text-muted-foreground" />
				<CardTitle>{title}</CardTitle>
			</div>
			<Badge variant="secondary">Coming Soon</Badge>
		</div>
		<CardDescription>{description}</CardDescription>
	</CardHeader>
	<CardContent>
		<!-- Decorative preview of a not-yet-built feature. The "Coming Soon" badge in
		     the header is the real status; this list is non-interactive filler, so it's
		     aria-hidden (screen readers announce title + badge + description, not
		     features that don't work yet). NOTE: no opacity-50 — axe checks
		     color-contrast on visually-rendered text even when aria-hidden, and dimming
		     muted-foreground drops it below WCAG AA. Full-opacity muted-foreground
		     (~5:1) already reads as clearly secondary. -->
		<div class="space-y-3" aria-hidden="true">
			{#each items as item (item.label)}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<item.icon class="h-4 w-4" />
						<span>{item.label}</span>
					</div>
					<span class="text-sm text-muted-foreground">{item.value ?? '—'}</span>
				</div>
			{/each}
		</div>
	</CardContent>
</Card>
