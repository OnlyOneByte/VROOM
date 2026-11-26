<script lang="ts">
	import { untrack } from 'svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import type { Driver } from '#lib/types/index.ts';
	import { driverColor } from '#lib/utils/driver-helpers.ts';
	import SplittingSection from './SplittingSection.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import {
		currentOfflineQueueOwner,
		loadCachedVehicles,
		updateCachedVehicle
	} from '#lib/utils/offline-storage.ts';

	interface Props {
		vehicleId: string;
		enabled: boolean;
	}

	let { vehicleId, enabled: initiallyEnabled }: Props = $props();

	let enabled = $state(false);
	let drivers = $state<Driver[]>([]);
	let busy = $state(false);
	let listState = $state<'loading' | 'ready' | 'error'>('loading');
	let guestName = $state('');
	let renaming = $state<{ id: string; name: string } | null>(null);
	let backfillOpen = $state(false);

	let active = $derived(drivers.filter(d => !d.archived));
	let archivedGuests = $derived(drivers.filter(d => d.archived && !d.userId));

	$effect(() => {
		enabled = initiallyEnabled;
		if (initiallyEnabled) untrack(() => void reload());
	});

	async function reload() {
		if (drivers.length === 0) listState = 'loading';
		try {
			drivers = (await driverApi.list(vehicleId)) ?? [];
			listState = 'ready';
		} catch {
			listState = 'error';
		}
	}

	async function run(action: () => Promise<unknown>, failure: string) {
		busy = true;
		try {
			await action();
			await reload();
		} catch (error) {
			appStore.showError(`${failure} ${userFacingErrorMessage(error)}`);
		} finally {
			busy = false;
		}
	}

	function refreshCachedCar(on: boolean) {
		const car = loadCachedVehicles().find(v => v.id === vehicleId);
		if (!car) return;
		const carShare = car.carShare
			? { ...car.carShare, enabled: on }
			: { enabled: on, manage: true, record: true };
		updateCachedVehicle({ ...car, carShareEnabled: on, carShare }, currentOfflineQueueOwner());
	}

	function toggle(next: boolean) {
		void run(
			async () => {
				await driverApi.setCarShare(vehicleId, next);
				enabled = next;
				refreshCachedCar(next);
			},
			`Couldn't turn car sharing ${next ? 'on' : 'off'}.`
		);
	}

	function addGuest(event: SubmitEvent) {
		event.preventDefault();
		const name = guestName.trim();
		if (!name) return;
		void run(async () => {
			await driverApi.addGuest(vehicleId, name);
			guestName = '';
		}, "Couldn't add the driver.");
	}

	function saveRename(event: SubmitEvent) {
		event.preventDefault();
		const target = renaming;
		if (!target?.name.trim()) return;
		void run(async () => {
			await driverApi.update(vehicleId, target.id, { name: target.name.trim() });
			renaming = null;
		}, "Couldn't rename the driver.");
	}

	function roleOf(driver: Driver): string {
		if (!driver.userId) return 'guest';
		return driver.userId === authStore.user?.id ? 'you' : '';
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center justify-between gap-4">
			<CardTitle id="car-sharing-title">Car sharing</CardTitle>
			{#if busy}
				<LoaderCircle
					class="ml-auto size-4 animate-spin text-muted-foreground"
					aria-label="Saving"
				/>
			{/if}
			<Switch
				aria-labelledby="car-sharing-title"
				checked={enabled}
				disabled={busy}
				onCheckedChange={toggle}
			/>
		</div>
		<CardDescription>Track who drove and who paid.</CardDescription>
	</CardHeader>
	{#if enabled}
		<CardContent class="space-y-4">
			{#if listState === 'loading'}
				<div class="space-y-3" aria-label="Loading drivers">
					<Skeleton class="h-6 w-40" />
					<Skeleton class="h-6 w-32" />
				</div>
			{:else if listState === 'error'}
				<div class="flex items-center justify-between gap-3 text-sm" role="alert">
					<span>Couldn't load the drivers.</span>
					<Button size="lg" variant="outline" onclick={() => void reload()}>Retry</Button>
				</div>
			{/if}
			<ul class="space-y-1" aria-label="Drivers">
				{#each active as driver (driver.id)}
					<li class="flex min-h-10 items-center gap-3">
						<span
							class="size-2.5 shrink-0 rounded-full"
							style:background-color={driverColor(driver)}
							aria-hidden="true"
						></span>
						{#if renaming?.id === driver.id}
							<form class="flex flex-1 gap-2" onsubmit={saveRename}>
								<Input
									aria-label="New name for {driver.name}"
									bind:value={renaming.name}
									maxlength={50}
								/>
								<Button type="submit" size="lg" disabled={busy}>Save</Button>
								<Button type="button" size="lg" variant="ghost" onclick={() => (renaming = null)}>
									Cancel
								</Button>
							</form>
						{:else}
							<span class="flex-1 truncate">
								{driver.name}
								{#if roleOf(driver)}<span class="text-muted-foreground">
										· {roleOf(driver)}
									</span>{/if}
							</span>
							{#if !driver.userId}
								<Button
									size="lg"
									class="px-3"
									variant="ghost"
									disabled={busy}
									aria-label="Rename {driver.name}"
									onclick={() => (renaming = { id: driver.id, name: driver.name })}
								>
									Rename
								</Button>
								<Button
									size="lg"
									class="px-3"
									variant="ghost"
									disabled={busy}
									aria-label="Archive {driver.name}"
									onclick={() =>
										run(
											() => driverApi.update(vehicleId, driver.id, { archived: true }),
											"Couldn't archive the driver."
										)}
								>
									Archive
								</Button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>

			<form class="flex gap-2" onsubmit={addGuest}>
				<Input
					aria-label="Guest driver's name"
					placeholder="Add a guest driver"
					bind:value={guestName}
					maxlength={50}
				/>
				<Button type="submit" size="lg" variant="outline" disabled={busy || !guestName.trim()}>
					Add
				</Button>
			</form>

			{#if archivedGuests.length > 0}
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground">Archived</p>
					{#each archivedGuests as driver (driver.id)}
						<div class="flex min-h-10 items-center justify-between gap-3 text-muted-foreground">
							<span class="truncate">{driver.name}</span>
							<Button
								size="lg"
								class="px-3"
								variant="ghost"
								disabled={busy}
								aria-label="Restore {driver.name}"
								onclick={() =>
									run(
										() => driverApi.update(vehicleId, driver.id, { archived: false }),
										"Couldn't restore the driver."
									)}
							>
								Restore
							</Button>
						</div>
					{/each}
				</div>
			{/if}
			<p class="text-xs text-muted-foreground">
				Members drive under their own name. Archived drivers keep their past entries.
			</p>
			{#if listState === 'ready'}
				<SplittingSection {vehicleId} drivers={active} />
			{/if}
			<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
				<div class="space-y-0.5">
					<p class="text-sm font-medium">Past entries</p>
					<p class="text-xs text-muted-foreground">
						Nothing before car sharing has a driver yet. Fill it in, and undo it if needed.
					</p>
				</div>
				<Button variant="outline" size="lg" onclick={() => (backfillOpen = true)}>
					Fill in drivers
				</Button>
			</div>
		</CardContent>
	{/if}
</Card>

{#if backfillOpen}
	{#await import('./BackfillDialog.svelte') then { default: BackfillDialog }}
		<BackfillDialog bind:open={backfillOpen} {vehicleId} drivers={active} />
	{/await}
{/if}
