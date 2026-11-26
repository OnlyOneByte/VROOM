<script lang="ts">
	import { ArrowRight, Copy, Download } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import type { DriverBalances } from '#lib/types/index.ts';
	import { driverColor } from '#lib/utils/driver-helpers.ts';
	import { triggerBlobDownload } from '#lib/utils/download.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { balancesCsv, balancesText } from './balances-export';

	interface Props {
		vehicleId: string;
		from: Date;
		to: Date;
		description?: string;
	}

	let { vehicleId, from, to, description = 'Last 30 days' }: Props = $props();

	let fromTime = $derived(from.getTime());
	let toTime = $derived(to.getTime());
	let data = $state<DriverBalances | null>(null);
	let phase = $state<'loading' | 'ready' | 'hidden' | 'error'>('loading');
	let latest = 0;

	async function load(car: string, start: number, end: number) {
		const request = ++latest;
		phase = 'loading';
		try {
			const result = await driverApi.balances(car, { from: new Date(start), to: new Date(end) });
			if (request !== latest) return;
			data = result;
			phase = result ? 'ready' : 'hidden';
		} catch {
			if (request === latest) phase = 'error';
		}
	}

	$effect(() => {
		void load(vehicleId, fromTime, toTime);
	});

	const money = (n: number) => formatCurrency(n, undefined, 2);
	const standing = (balance: number) =>
		Math.abs(balance) < 0.005
			? 'Settled'
			: balance > 0
				? `Owes ${money(balance)}`
				: `Is owed ${money(-balance)}`;
	let gap = $derived((data?.unassigned ?? 0) + (data?.unpaid ?? 0));
	let colorOf = $derived(new Map((data?.drivers ?? []).map(d => [d.driverId, d])));

	async function copyText() {
		if (!data) return;
		try {
			await navigator.clipboard.writeText(balancesText(data, description));
			appStore.addNotification({ type: 'success', message: 'Copied who pays whom.' });
		} catch {
			appStore.showError("Couldn't copy. Your browser blocked the clipboard.");
		}
	}

	function downloadCsv() {
		if (!data) return;
		const csv = '\uFEFF' + balancesCsv(data);
		triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'balances.csv');
	}
</script>

{#if phase !== 'hidden'}
	<Card>
		<CardHeader>
			<CardTitle>{data?.scope === 'own' ? 'Your balance' : 'Balances'}</CardTitle>
			<CardDescription>{description}</CardDescription>
		</CardHeader>
		<CardContent class="space-y-4">
			{#if phase === 'loading'}
				<div class="space-y-3" aria-label="Loading balances">
					<Skeleton class="h-6 w-48" />
					<Skeleton class="h-6 w-40" />
				</div>
			{:else if phase === 'error'}
				<div class="flex items-center justify-between gap-3 text-sm" role="alert">
					<span>Couldn't load the balances.</span>
					<Button size="lg" variant="outline" onclick={() => load(vehicleId, fromTime, toTime)}>
						Retry
					</Button>
				</div>
			{:else if data && data.drivers.length === 0}
				<p class="text-sm text-muted-foreground">No shared costs in this period yet.</p>
			{:else if data}
				<ul class="divide-y text-sm" aria-label="What each driver owes and paid">
					{#each data.drivers as driver (driver.driverId)}
						<li class="py-2">
							<div class="flex items-center gap-2">
								<span
									class="size-2.5 shrink-0 rounded-full"
									style:background-color={driverColor(driver)}
									aria-hidden="true"
								></span>
								<span class="min-w-0 flex-1 truncate font-medium">
									{driver.name}
									{#if driver.you && data.scope === 'everyone'}
										<span class="font-normal text-muted-foreground">(you)</span>
									{/if}
								</span>
								<span class="tabular-nums">{standing(driver.balance)}</span>
							</div>
							<p class="pl-4.5 text-xs text-muted-foreground tabular-nums">
								Share {money(driver.owed)} · paid {money(driver.paid)}
							</p>
						</li>
					{/each}
				</ul>

				<div class="space-y-2">
					<p class="text-sm font-medium">Who pays whom</p>
					{#if data.transfers.length === 0}
						<p class="text-sm text-muted-foreground">Everyone is settled up.</p>
					{:else}
						<ul class="space-y-1 text-sm" aria-label="Who pays whom">
							{#each data.transfers as t (`${t.fromDriverId}-${t.toDriverId}`)}
								<li class="flex min-h-10 items-center gap-2">
									<span
										class="size-2.5 shrink-0 rounded-full"
										style:background-color={driverColor(
											colorOf.get(t.fromDriverId) ?? { color: null }
										)}
										aria-hidden="true"
									></span>
									<span class="truncate">{t.fromName}</span>
									<ArrowRight class="size-4 shrink-0 text-muted-foreground" aria-label="pays" />
									<span class="min-w-0 flex-1 truncate">{t.toName}</span>
									<span class="font-medium tabular-nums">{money(t.amount)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				{#if gap > 0.005}
					<p class="text-xs text-muted-foreground">
						{money(gap)} isn't anyone's yet: distance no one is credited with, or costs with no payer.
						Fill in drivers to include it.
					</p>
				{/if}
				<p class="text-xs text-muted-foreground">
					At most one payment per driver settles it up. VROOM doesn't move any money.
				</p>
				<div class="flex flex-wrap gap-2">
					<Button size="lg" variant="outline" onclick={copyText}>
						<Copy class="size-4" aria-hidden="true" /> Copy as text
					</Button>
					<Button size="lg" variant="outline" onclick={downloadCsv}>
						<Download class="size-4" aria-hidden="true" /> Download CSV
					</Button>
				</div>
			{/if}
		</CardContent>
	</Card>
{/if}
