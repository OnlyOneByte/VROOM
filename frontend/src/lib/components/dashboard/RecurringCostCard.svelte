<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';

	interface Props {
		count: number;
		monthlyTotal: number;
	}

	let { count, monthlyTotal }: Props = $props();
</script>

<Card.Root variant="section">
	<Card.Header class="flex flex-row items-center justify-between gap-3">
		<Card.Title level={2} class="text-base">Recurring costs</Card.Title>
		<a
			href={resolve(routes.reminders)}
			class="rounded-sm text-sm font-semibold text-accent-ink outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			All<span class="sr-only"> recurring expenses</span>
		</a>
	</Card.Header>
	<Card.Content>
		<p class="flex items-baseline gap-2">
			<span class="text-3xl font-bold tabular-nums">{formatCurrency(monthlyTotal)}</span>
			<span class="text-sm text-muted-foreground">a month</span>
		</p>
		<p class="mt-1 text-sm text-muted-foreground">
			Across {count} recurring expense{count !== 1 ? 's' : ''}.
		</p>
	</Card.Content>
</Card.Root>
