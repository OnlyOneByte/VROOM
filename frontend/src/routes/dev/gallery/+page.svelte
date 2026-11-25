<script lang="ts">
	import { dev } from '$app/env';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import BrandMark from '#lib/components/common/BrandMark.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import HowItWorks from '#lib/components/common/how-it-works.svelte';
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { Button, buttonVariants as buttonClass } from '#lib/components/ui/button/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Alert, AlertTitle, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Tabs, TabsContent, TabsList, TabsTrigger } from '#lib/components/ui/tabs/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import * as Popover from '#lib/components/ui/popover/index.ts';
	import { AppLineChart } from '#lib/components/charts/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import ChartCard from '#lib/components/charts/ChartCard.svelte';
	import { Inbox, DollarSign, TrendingUp, Car, Plus } from '@lucide/svelte';

	const buttonVariants = [
		'default',
		'accent',
		'destructive',
		'outline',
		'secondary',
		'ghost',
		'link'
	] as const;
	const buttonSizes = ['default', 'sm', 'lg'] as const;
	const badgeVariants = [
		'default',
		'secondary',
		'destructive',
		'outline',
		'due',
		'soon',
		'ok',
		'info'
	] as const;
	const alertVariants = ['default', 'destructive', 'warning', 'success'] as const;

	const trend = [
		{ date: new Date(2026, 0, 1), amount: 120 },
		{ date: new Date(2026, 1, 1), amount: 240 },
		{ date: new Date(2026, 2, 1), amount: 180 }
	];
	const trendConfig = { amount: { label: 'Amount', color: 'var(--primary)' } };
	const trendAverage = trend.reduce((sum, d) => sum + d.amount, 0) / trend.length;

	const pageHeaderWithBack = `<PageHeader title="Edit Odometer Reading" description="2020 Toyota Camry">
	{#snippet back()}
		<Button variant="ghost" size="icon-lg" class="shrink-0" aria-label="Back">
			<ArrowLeft class="size-5" />
		</Button>
	{/snippet}
</PageHeader>`;

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

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Brand mark</h2>
			<p class="text-sm text-muted-foreground">
				The logo is <code>BrandMark</code>, never the car emoji. It is decorative, so keep the
				"VROOM" wordmark beside it; pass a class to change its size or colour.
			</p>
			<div class="flex flex-wrap items-center gap-8">
				<div class="flex items-center gap-3" data-testid="gallery-brand-mark">
					<BrandMark />
					<span class="text-xl font-bold text-foreground">VROOM</span>
				</div>
				<div class="inline-flex items-center justify-center w-10 h-10 bg-primary rounded-xl">
					<BrandMark class="h-5 w-5 text-primary-foreground" />
				</div>
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<BrandMark class="h-4 w-4 text-muted-foreground" />
					<span>VROOM</span>
				</div>
			</div>
		</section>

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
				<Button variant="ghost" size="icon" aria-label="Add"><Plus /></Button>
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Controls</h2>
			<div class="flex flex-wrap items-center gap-6">
				<label class="flex min-h-10 items-center gap-3 text-sm">
					<Switch checked aria-label="Backups on" />
					On
				</label>
				<label class="flex min-h-10 items-center gap-3 text-sm">
					<Switch aria-label="Backups off" />
					Off
				</label>
				<label class="flex min-h-10 items-center gap-3 text-sm">
					<Checkbox checked aria-label="Missed fill-up" />
					Missed the previous fill-up
				</label>
				<Select.Root type="single" value="daily">
					<Select.Trigger class="w-48" aria-label="Vehicle">Daily Driver</Select.Trigger>
					<Select.Content>
						<Select.Item value="daily" label="Daily Driver" />
						<Select.Item value="weekend" label="Weekend Car" />
					</Select.Content>
				</Select.Root>
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Surfaces</h2>
			<p class="text-sm text-muted-foreground">
				Cards are rare; a <code>variant="section"</code> card is a ruled section with no fill.
			</p>
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
				<Card.Root>
					<Card.Header><Card.Title level={3}>Card</Card.Title></Card.Header>
					<Card.Content class="text-sm text-muted-foreground">
						Surface fill, hairline edge.
					</Card.Content>
				</Card.Root>
				<Card.Root variant="section">
					<Card.Header><Card.Title level={3}>Section</Card.Title></Card.Header>
					<Card.Content class="text-sm text-muted-foreground">A rule above, no fill.</Card.Content>
				</Card.Root>
			</div>
			<div class="flex flex-wrap gap-2">
				<Dialog.Root>
					<Dialog.Trigger class={buttonClass({ variant: 'outline' })}>Open dialog</Dialog.Trigger>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Import expenses</Dialog.Title>
							<Dialog.Description>Pick a CSV exported from another tracker.</Dialog.Description>
						</Dialog.Header>
						<Dialog.Footer>
							<Button variant="outline">Cancel</Button>
							<Button>Import</Button>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Root>
				<AlertDialog.Root>
					<AlertDialog.Trigger class={buttonClass({ variant: 'outline' })}>
						Open confirm
					</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Delete "Car wash"?</AlertDialog.Title>
							<AlertDialog.Description>This can't be undone.</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
							<AlertDialog.Action>Delete</AlertDialog.Action>
						</AlertDialog.Footer>
					</AlertDialog.Content>
				</AlertDialog.Root>
				<Sheet.Root>
					<Sheet.Trigger class={buttonClass({ variant: 'outline' })}>Open sheet</Sheet.Trigger>
					<Sheet.Content>
						<Sheet.Header>
							<Sheet.Title>Filters</Sheet.Title>
							<Sheet.Description>Narrow the list by vehicle and category.</Sheet.Description>
						</Sheet.Header>
					</Sheet.Content>
				</Sheet.Root>
				<Popover.Root>
					<Popover.Trigger class={buttonClass({ variant: 'outline' })}>
						Open popover
					</Popover.Trigger>
					<Popover.Content>
						<p class="text-sm">A popover sits on the surface with the pop shadow.</p>
					</Popover.Content>
				</Popover.Root>
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Hero figure</h2>
			<p class="text-sm text-muted-foreground">
				At most one per screen: the answer to the screen's question, with its comparison in the meta
				voice.
			</p>
			<Card.Root>
				<Card.Content>
					<HeroFigure label="Spent in the last 30 days" value={formatCurrency(624.04)}>
						{#snippet action()}
							<Badge variant="outline">30 days</Badge>
						{/snippet}
						{#snippet meta()}
							<span>
								<span class="font-medium text-foreground">6% less</span> than the 30 days before
							</span>
						{/snippet}
					</HeroFigure>
				</Card.Content>
			</Card.Root>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Page header with back</h2>
			<p class="text-sm text-muted-foreground">
				Detail and form pages pass a <code>back</code> snippet; the title stays the same size.
			</p>
			<pre class="whitespace-pre-wrap break-words rounded-md border bg-muted p-4 text-xs"><code
					>{pageHeaderWithBack}</code
				></pre>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Tabs</h2>
			<p class="text-sm text-muted-foreground">
				Triggers are 40px tall, so they clear the tap target at every width.
			</p>
			<Tabs value="overview">
				<TabsList class="grid w-full grid-cols-3">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="expenses">Expenses</TabsTrigger>
					<TabsTrigger value="finance">Finance</TabsTrigger>
				</TabsList>
				<TabsContent value="overview" class="text-sm text-muted-foreground">
					Overview panel
				</TabsContent>
				<TabsContent value="expenses" class="text-sm text-muted-foreground">
					Expenses panel
				</TabsContent>
				<TabsContent value="finance" class="text-sm text-muted-foreground">
					Finance panel
				</TabsContent>
			</Tabs>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Badges</h2>
			<div class="flex flex-wrap gap-2">
				{#each badgeVariants as v (v)}
					<Badge variant={v}>{v}</Badge>
				{/each}
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Alerts</h2>
			{#each alertVariants as v (v)}
				<Alert variant={v}>
					<AlertTitle>{v} alert</AlertTitle>
					<AlertDescription>
						Use Alert variants for status — never hand-tinted divs.
					</AlertDescription>
				</Alert>
			{/each}
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Form field</h2>
			<div class="max-w-sm space-y-2">
				<Label for="gallery-amount">Amount</Label>
				<Input
					id="gallery-amount"
					type="number"
					placeholder="0.00"
					aria-invalid={true}
					aria-describedby="gallery-amount-error"
				/>
				<FormFieldError id="gallery-amount-error">Amount must be positive</FormFieldError>
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">How it works disclosure</h2>
			<div class="max-w-sm">
				<p class="text-sm text-muted-foreground">One line that says what this does.</p>
				<HowItWorks>
					<p class="text-sm text-muted-foreground">
						The longer explanation people need once, closed by default.
					</p>
				</HowItWorks>
			</div>
		</section>

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
							<AlertDescription>
								Show a visible, recoverable message — never a silent catch.
							</AlertDescription>
						</Alert>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header><Card.Title>Populated</Card.Title></Card.Header>
					<Card.Content>
						<p class="text-sm">The happy path with real content.</p>
						<p class="text-sm text-muted-foreground">
							Secondary text uses muted-foreground (AA contrast).
						</p>
					</Card.Content>
				</Card.Root>
			</div>
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">StatCard grid</h2>
			<StatCardGrid items={statItems} columns={3} />
		</section>

		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Charts (ChartCard 4-state wrapper)</h2>
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<AppLineChart
					level={3}
					title="Populated"
					data={trend}
					x="date"
					y="amount"
					config={trendConfig}
					series={[{ key: 'amount', label: 'Amount', color: 'var(--primary)' }]}
				/>
				<AppLineChart
					level={3}
					title="Summary, dashed average and footer"
					description="Monthly spending, with its average drawn as a dashed line"
					data={trend}
					x="date"
					y="amount"
					config={trendConfig}
					series={[{ key: 'amount', label: 'Amount', color: 'var(--primary)' }]}
					referenceLines={[{ value: trendAverage, label: 'Average' }]}
				>
					{#snippet summary()}
						<p class="text-2xl font-bold tabular-nums">{formatCurrency(trendAverage)}</p>
						<p class="text-sm text-muted-foreground">average per month</p>
					{/snippet}
					{#snippet footer()}
						<p class="text-sm text-muted-foreground">One sentence that explains the chart.</p>
					{/snippet}
				</AppLineChart>
				<ChartCard
					level={3}
					title="Empty"
					isEmpty
					emptyTitle="No data yet"
					emptyDescription="Charts show an empty state, never a blank box."
				>
					<div></div>
				</ChartCard>
				<ChartCard title="Loading" level={3} isLoading>
					<div></div>
				</ChartCard>
				<ChartCard title="Error" level={3} error="Couldn't load the chart data.">
					<div></div>
				</ChartCard>
			</div>
		</section>
	</div>
{/if}
