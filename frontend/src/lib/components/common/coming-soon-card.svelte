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
		<div class="space-y-3 opacity-50">
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
