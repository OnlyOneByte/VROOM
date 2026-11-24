<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { routes } from '#lib/routes.ts';
	import type { AttentionItem } from './dashboard-data';

	interface Props {
		items: AttentionItem[];
		title?: string;
	}

	let { items, title = 'Needs attention' }: Props = $props();
</script>

{#if items.length > 0}
	<Card.Root class="gap-3 py-5" data-testid="needs-attention">
		<Card.Header class="px-5">
			<Card.Title level={2} class="text-lg">{title}</Card.Title>
		</Card.Header>
		<Card.Content class="px-5">
			<ul class="divide-y" role="list">
				{#each items as item (item.id)}
					<li class="relative flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
						<div class="min-w-0">
							<a
								href={resolve(routes[item.href])}
								class="block truncate rounded-sm text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
							>
								{item.title}
							</a>
							<p class="text-xs text-muted-foreground">{item.detail}</p>
						</div>
						<div class="flex shrink-0 items-center gap-3">
							<span
								class="text-xs font-semibold {item.status === 'overdue'
									? 'text-warning'
									: 'text-muted-foreground'}"
							>
								{item.status === 'overdue' ? 'Overdue' : 'Soon'}
							</span>
							{#if item.action}
								<Button
									variant="outline"
									size="sm"
									class="relative"
									href={item.action.href}
									aria-label="{item.action.label}: {item.title}"
								>
									{item.action.label}
								</Button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
{/if}
