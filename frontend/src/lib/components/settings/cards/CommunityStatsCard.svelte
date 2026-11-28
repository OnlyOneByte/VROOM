<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { COUNTRY_CODES, SUBDIVISIONS } from '#lib/constants/regions.ts';
	import type { CommunityStatsUpdate } from '#lib/types/index.ts';

	interface Props {
		optIn: boolean;
		region: string | null;
		minGroup?: number;
		onSave: (_updates: CommunityStatsUpdate) => Promise<void>;
	}

	let { optIn, region, minGroup = 30, onSave }: Props = $props();

	const NOT_SET = 'not-set';
	const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
	const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
	const countries = COUNTRY_CODES.map(code => ({ code, name: countryNames.of(code) ?? code })).sort(
		byName
	);

	let pendingOptIn = $state<boolean | null>(null);
	let pendingRegion = $state<{ value: string | null } | null>(null);

	let shownOptIn = $derived(pendingOptIn ?? optIn);
	let shownRegion = $derived(pendingRegion ? pendingRegion.value : region);
	let country = $derived(shownRegion?.split('-')[0] ?? null);
	let subdivision = $derived(shownRegion?.includes('-') ? shownRegion : null);
	let subdivisions = $derived(
		Object.entries(SUBDIVISIONS)
			.filter(([code]) => country !== null && code.startsWith(`${country}-`))
			.map(([code, name]) => ({ code, name }))
			.sort(byName)
	);
	let saving = $derived(pendingOptIn !== null || pendingRegion !== null);

	function nameOf(code: string | null, options: { code: string; name: string }[]): string {
		return options.find(option => option.code === code)?.name ?? 'Not set';
	}

	async function saveOptIn(checked: boolean) {
		pendingOptIn = checked;
		await onSave({ communityStatsOptIn: checked }).catch(() => undefined);
		pendingOptIn = null;
	}

	async function saveRegion(next: string | null) {
		if (next === region) return;
		pendingRegion = { value: next };
		await onSave({ communityRegion: next }).catch(() => undefined);
		pendingRegion = null;
	}
</script>

<Card variant="section" id="community-comparisons">
	<CardHeader>
		<CardTitle level={2} class="text-base">Community comparisons</CardTitle>
		<CardDescription>
			Share anonymous averages from your vehicles so you and other people on this server can see how
			your vehicle compares.
		</CardDescription>
	</CardHeader>
	<CardContent class="space-y-5">
		<ul class="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
			<li>
				Only averages and rounded group sizes for groups of about {minGroup} or more people are ever shown,
				both with random noise added — never your own numbers.
			</li>
			<li>
				What's used: make, model and model year, powertrain, vehicle kind, vehicle age, and your
				fuel, maintenance and insurance costs from the last 12 months. Your region is used only if
				you set one below.
			</li>
			<li>
				Never used: VIN, plate, nickname, notes, photos, locations, exact dates or odometer
				readings.
			</li>
			<li>You can turn this off at any time. You'll be left out from the next daily refresh.</li>
		</ul>

		<div class="flex items-center justify-between gap-4">
			<Label for="community-stats-opt-in" class="text-sm font-medium">
				Include my vehicles in community stats
			</Label>
			<div class="flex shrink-0 items-center gap-2">
				{#if pendingOptIn !== null}
					<LoaderCircle
						class="h-4 w-4 animate-spin text-muted-foreground"
						data-testid="community-saving"
					/>
				{/if}
				<Switch
					id="community-stats-opt-in"
					checked={shownOptIn}
					onCheckedChange={saveOptIn}
					disabled={saving}
					data-testid="community-opt-in"
				/>
			</div>
		</div>

		<div class="space-y-2">
			<div class="flex min-h-4 items-center gap-2" data-testid="community-region-label-row">
				<Label for="community-region-country">Region (optional)</Label>
				{#if pendingRegion !== null}
					<LoaderCircle
						class="h-4 w-4 animate-spin text-muted-foreground"
						data-testid="community-region-saving"
					/>
				{/if}
			</div>
			<Select.Root
				type="single"
				value={country ?? NOT_SET}
				disabled={saving}
				onValueChange={v => void saveRegion(!v || v === NOT_SET ? null : v)}
			>
				<Select.Trigger
					id="community-region-country"
					class="w-full min-w-0"
					data-testid="community-region-country"
				>
					<span class="truncate">{nameOf(country, countries)}</span>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={NOT_SET} label="Not set">Not set</Select.Item>
					{#each countries as option (option.code)}
						<Select.Item value={option.code} label={option.name}>{option.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if subdivisions.length > 0}
			<div class="space-y-2">
				<Label for="community-region-subdivision">State or province (optional)</Label>
				<Select.Root
					type="single"
					value={subdivision ?? NOT_SET}
					disabled={saving}
					onValueChange={v => void saveRegion(!v || v === NOT_SET ? country : v)}
				>
					<Select.Trigger
						id="community-region-subdivision"
						class="w-full min-w-0"
						data-testid="community-region-subdivision"
					>
						<span class="truncate">{nameOf(subdivision, subdivisions)}</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Item value={NOT_SET} label="Not set">Not set</Select.Item>
						{#each subdivisions as option (option.code)}
							<Select.Item value={option.code} label={option.name}>{option.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		{/if}

		<p class="text-xs text-muted-foreground">
			Off by default. Changing it doesn't affect your own data.
		</p>
	</CardContent>
</Card>
