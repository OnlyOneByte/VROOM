<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import type { Driver, GroupRule, SplitRules } from '#lib/types/index.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	interface Props {
		vehicleId: string;
		drivers: Driver[];
	}

	let { vehicleId, drivers }: Props = $props();

	type Group = keyof SplitRules;

	const GROUPS: {
		key: Group;
		label: string;
		hint: string;
		options: [GroupRule['kind'], string][];
	}[] = [
		{
			key: 'running',
			label: 'Running costs',
			hint: 'Fuel, charging, maintenance and other costs of driving.',
			options: [
				['distance', 'By distance driven'],
				['equal', 'Equally'],
				['fixed', 'Fixed percentages'],
				['payer', 'Not split']
			]
		},
		{
			key: 'ownership',
			label: 'Ownership costs',
			hint: 'Loan, insurance, registration and tax.',
			options: [
				['payer', 'Not split'],
				['fixed', 'Fixed percentages']
			]
		}
	];

	let rules = $state<SplitRules | null>(null);
	let draft = $state<Record<Group, Record<string, string>>>({ running: {}, ownership: {} });
	let editing = $state<Record<Group, boolean>>({ running: false, ownership: false });
	let failed = $state(false);
	let busy = $state(false);

	async function load() {
		failed = false;
		try {
			rules = await driverApi.rules(vehicleId);
		} catch {
			failed = true;
		}
	}

	$effect(() => {
		void load();
	});

	const labelOf = (group: (typeof GROUPS)[number], kind: string) =>
		group.options.find(([value]) => value === kind)?.[1] ?? '';

	function evenShares(): Record<string, string> {
		const each = drivers.length ? Math.floor(100 / drivers.length) : 0;
		return Object.fromEntries(
			drivers.map((d, i) => [d.id, String(i === 0 ? 100 - each * (drivers.length - 1) : each)])
		);
	}

	function sumOf(group: Group): number {
		return Object.values(draft[group]).reduce((n, v) => n + (Number(v) || 0), 0);
	}

	async function save(next: SplitRules) {
		busy = true;
		try {
			rules = await driverApi.setRules(vehicleId, next);
			appStore.addNotification({ type: 'success', message: 'Splitting saved.' });
			return true;
		} catch (error) {
			appStore.showError(`Couldn't save the splitting. ${userFacingErrorMessage(error)}`);
			return false;
		} finally {
			busy = false;
		}
	}

	function pick(group: Group, kind: string) {
		if (!rules) return;
		if (kind === 'fixed') {
			const current = rules[group];
			draft[group] =
				current.kind === 'fixed'
					? Object.fromEntries(
							drivers.map(d => [d.id, current.shares[d.id] ? String(current.shares[d.id]) : ''])
						)
					: evenShares();
			editing[group] = true;
			return;
		}
		editing[group] = false;
		void save({ ...rules, [group]: { kind } } as SplitRules);
	}

	async function saveShares(group: Group) {
		if (!rules) return;
		const shares = Object.fromEntries(
			Object.entries(draft[group])
				.map(([id, v]) => [id, Number(v) || 0] as const)
				.filter(([, v]) => v > 0)
		);
		if (await save({ ...rules, [group]: { kind: 'fixed', shares } } as SplitRules)) {
			editing[group] = false;
		}
	}
</script>

<div class="space-y-3 border-t pt-4">
	<div class="space-y-0.5">
		<p class="text-sm font-medium">Splitting</p>
		<p class="text-xs text-muted-foreground">
			How shared costs are divided when working out who owes whom.
		</p>
	</div>
	{#if failed}
		<div class="flex items-center justify-between gap-3 text-sm" role="alert">
			<span>Couldn't load the splitting.</span>
			<Button size="lg" variant="outline" onclick={() => void load()}>Retry</Button>
		</div>
	{:else if rules}
		{#each GROUPS as group (group.key)}
			{@const rule = rules[group.key]}
			<div class="space-y-2">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="min-w-0">
						<Label for="split-{group.key}">{group.label}</Label>
						<p class="text-xs text-muted-foreground">{group.hint}</p>
					</div>
					<Select.Root
						type="single"
						value={editing[group.key] ? 'fixed' : rule.kind}
						onValueChange={kind => pick(group.key, kind)}
					>
						<Select.Trigger id="split-{group.key}" class="min-h-10 w-48" disabled={busy}>
							{labelOf(group, editing[group.key] ? 'fixed' : rule.kind)}
						</Select.Trigger>
						<Select.Content>
							{#each group.options as [value, label] (value)}
								<Select.Item {value} {label}>{label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if editing[group.key]}
					{@const sum = sumOf(group.key)}
					<div class="space-y-2 rounded-md border p-3">
						{#each drivers as driver (driver.id)}
							<div class="flex items-center justify-between gap-3">
								<Label for="share-{group.key}-{driver.id}" class="font-normal">{driver.name}</Label>
								<div class="flex items-center gap-1">
									<Input
										id="share-{group.key}-{driver.id}"
										aria-label="{driver.name}'s share, in percent"
										class="h-10 w-20 text-right tabular-nums"
										type="number"
										inputmode="numeric"
										min="0"
										max="100"
										bind:value={draft[group.key][driver.id]}
									/>
									<span class="text-sm text-muted-foreground" aria-hidden="true">%</span>
								</div>
							</div>
						{/each}
						<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
							<p
								class="text-sm tabular-nums {sum === 100
									? 'text-muted-foreground'
									: 'text-destructive'}"
								role="status"
							>
								{sum === 100 ? 'Adds up to 100%' : `Adds up to ${sum}%. It needs to be 100%.`}
							</p>
							<div class="flex gap-2">
								<Button
									size="lg"
									variant="ghost"
									onclick={() => (editing[group.key] = false)}
									disabled={busy}
								>
									Cancel
								</Button>
								<Button
									size="lg"
									disabled={busy || sum !== 100}
									onclick={() => saveShares(group.key)}
								>
									Save
								</Button>
							</div>
						</div>
					</div>
				{:else if rule.kind === 'fixed'}
					<p class="text-xs text-muted-foreground">
						{drivers
							.filter(d => rule.shares[d.id])
							.map(d => `${d.name} ${rule.shares[d.id]}%`)
							.join(' · ')}
					</p>
				{/if}
			</div>
		{/each}
	{/if}
</div>
