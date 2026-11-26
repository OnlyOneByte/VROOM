<script lang="ts">
	import type { Component } from 'svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';

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

<Card variant="section">
	<CardHeader>
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<Icon class="size-4 text-muted-foreground" />
				<CardTitle level={2} class="text-base">{title}</CardTitle>
			</div>
			<Badge variant="outline">Coming soon</Badge>
		</div>
		<CardDescription>{description}</CardDescription>
	</CardHeader>
	<CardContent>
		<ul class="divide-y" aria-hidden="true">
			{#each items as item (item.label)}
				<li class="flex min-h-12 items-center justify-between gap-3 py-2">
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<item.icon class="size-4" />
						<span>{item.label}</span>
					</div>
					<span class="text-sm text-muted-foreground">{item.value ?? '—'}</span>
				</li>
			{/each}
		</ul>
	</CardContent>
</Card>
