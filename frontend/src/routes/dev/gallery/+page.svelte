<script lang="ts">
	// Component gallery (dev-only) — the LIVE source of truth for the VROOM kit.
	// Renders the reusable components in their key states + both viewports so an
	// agent (or human) can see "what good looks like" and COMPOSE from the kit
	// instead of reinventing. Pairs with .kiro/steering/DesignSystem.md.
	//
	// Route-smoke covers /dev/gallery (a11y + mobile + screenshot), so this page
	// doubles as a single capture target that exercises every component state —
	// e.g. it would surface a blank-chart / missing-empty-state regression at the
	// component level, before any feature route hits it.
	import { dev } from '$app/environment';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import Input from '$lib/components/ui/input/input.svelte';
	import { Label } from '$lib/components/ui/label';
	import { FormFieldError } from '$lib/components/ui/form-field';
	import * as Card from '$lib/components/ui/card';
	import { StatCardGrid, AppLineChart } from '$lib/components/charts';
	import ChartCard from '$lib/components/charts/ChartCard.svelte';
	import { Inbox, DollarSign, TrendingUp, Car, Plus } from '@lucide/svelte';

	const buttonVariants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
	const buttonSizes = ['default', 'sm', 'lg'] as const;
	const badgeVariants = ['default', 'secondary', 'destructive', 'outline'] as const;
	const alertVariants = ['default', 'destructive', 'warning', 'success'] as const;

	// Sample chart data for the "populated" state.
	const trend = [
		{ date: new Date(2026, 0, 1), amount: 120 },
		{ date: new Date(2026, 1, 1), amount: 240 },
		{ date: new Date(2026, 2, 1), amount: 180 }
	];
	const trendConfig = { amount: { label: 'Amount', color: 'var(--primary)' } };

	const statItems = [
		{ label: 'Total Vehicles', value: '2', icon: Car, iconColor: 'primary' as const },
		{ label: 'Total Expenses', value: '$955.72', icon: DollarSign, iconColor: 'chart-1' as const },
		{ label: 'Monthly Avg', value: '$80.00', icon: TrendingUp, iconColor: 'chart-2' as const }
	];
</script>

<svelte:head>
	<title>Component Gallery (dev) - VROOM</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if !dev}
	<div class="space-y-6">
		<EmptyState>
			{#snippet icon()}
				<Inbox class="h-12 w-12 text-muted-foreground mb-4" />
			{/snippet}
			{#snippet title()}
				Gallery is dev-only
			{/snippet}
			{#snippet description()}
				The component gallery is only available in development builds.
			{/snippet}
		</EmptyState>
	</div>
{:else}
	<div class="space-y-10 pb-24">
		<PageHeader
			title="Component Gallery"
			description="The live VROOM kit — compose from these, don't reinvent. See DesignSystem.md."
		/>

		<!-- Buttons -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Buttons</h2>
			<div class="flex flex-wrap gap-2">
				{#each buttonVariants as v (v)}
					<Button variant={v}>{v}</Button>
				{/each}
			</div>
			<div class="flex flex-wrap items-center gap-2">
				{#each buttonSizes as s (s)}
					<Button size={s}>size: {s}</Button>
				{/each}
				<Button disabled>disabled</Button>
			</div>
		</section>

		<!-- Badges -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Badges</h2>
			<div class="flex flex-wrap gap-2">
				{#each badgeVariants as v (v)}
					<Badge variant={v}>{v}</Badge>
				{/each}
			</div>
		</section>

		<!-- Alerts (status surfaces) -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Alerts</h2>
			{#each alertVariants as v (v)}
				<Alert variant={v}>
					<AlertTitle>{v} alert</AlertTitle>
					<AlertDescription>Use Alert variants for status — never hand-tinted divs.</AlertDescription>
				</Alert>
			{/each}
		</section>

		<!-- Form field (label + input + error wired) -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Form field</h2>
			<div class="max-w-sm space-y-2">
				<Label for="gallery-amount">Amount</Label>
				<Input id="gallery-amount" type="number" placeholder="0.00" aria-invalid={true} aria-describedby="gallery-amount-error" />
				<FormFieldError id="gallery-amount-error">Amount must be positive</FormFieldError>
			</div>
		</section>

		<!-- The Four-States contract, side by side -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">The Four States (every data view must handle all four)</h2>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Card.Root>
					<Card.Header><Card.Title>Loading</Card.Title></Card.Header>
					<Card.Content class="space-y-2">
						<Skeleton class="h-5 w-2/3" />
						<Skeleton class="h-5 w-1/2" />
						<Skeleton class="h-24 w-full" />
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header><Card.Title>Empty</Card.Title></Card.Header>
					<Card.Content>
						<EmptyState>
							{#snippet icon()}
								<Inbox class="h-10 w-10 text-muted-foreground mb-3" />
							{/snippet}
							{#snippet title()}
								Nothing here yet
							{/snippet}
							{#snippet description()}
								Empty states explain what's missing and offer the next action.
							{/snippet}
							{#snippet action()}
								<Button size="sm"><Plus class="mr-1 h-4 w-4" />Add the first one</Button>
							{/snippet}
						</EmptyState>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header><Card.Title>Error</Card.Title></Card.Header>
					<Card.Content>
						<Alert variant="destructive">
							<AlertTitle>Couldn't load</AlertTitle>
							<AlertDescription>Show a visible, recoverable message — never a silent catch.</AlertDescription>
						</Alert>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header><Card.Title>Populated</Card.Title></Card.Header>
					<Card.Content>
						<p class="text-sm">The happy path with real content.</p>
						<p class="text-sm text-muted-foreground">Secondary text uses muted-foreground (AA contrast).</p>
					</Card.Content>
				</Card.Root>
			</div>
		</section>

		<!-- StatCards -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">StatCard grid</h2>
			<StatCardGrid items={statItems} columns={3} />
		</section>

		<!-- Charts: the wrapper handles loading/empty/error/populated for you -->
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Charts (ChartCard 4-state wrapper)</h2>
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<AppLineChart title="Populated" data={trend} x="date" y="amount" config={trendConfig} series={[{ key: 'amount', label: 'Amount', color: 'var(--primary)' }]} />
				<ChartCard title="Empty" isEmpty emptyTitle="No data yet" emptyDescription="Charts show an empty state, never a blank box.">
					<div></div>
				</ChartCard>
				<ChartCard title="Loading" isLoading>
					<div></div>
				</ChartCard>
				<ChartCard title="Error" error="Failed to load chart data">
					<div></div>
				</ChartCard>
			</div>
		</section>
	</div>
{/if}
