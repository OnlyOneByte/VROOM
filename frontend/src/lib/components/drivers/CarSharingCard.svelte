<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
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
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	interface Props {
		vehicleId: string;
		enabled: boolean;
	}

	let { vehicleId, enabled: initiallyEnabled }: Props = $props();

	let enabled = $state(false);
	let drivers = $state<Driver[]>([]);
	let busy = $state(false);
	let guestName = $state('');
	let renaming = $state<{ id: string; name: string } | null>(null);

	let active = $derived(drivers.filter(d => !d.archived));
	let archivedGuests = $derived(drivers.filter(d => d.archived && !d.userId));

	$effect(() => {
		enabled = initiallyEnabled;
		if (initiallyEnabled) void reload();
	});

	async function reload() {
		drivers = (await driverApi.list(vehicleId).catch(() => null)) ?? [];
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

	function toggle(next: boolean) {
		void run(
			async () => {
				await driverApi.setCarShare(vehicleId, next);
				enabled = next;
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
								<Button type="submit" size="sm" disabled={busy}>Save</Button>
								<Button type="button" size="sm" variant="ghost" onclick={() => (renaming = null)}>
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
									size="sm"
									variant="ghost"
									disabled={busy}
									aria-label="Rename {driver.name}"
									onclick={() => (renaming = { id: driver.id, name: driver.name })}
								>
									Rename
								</Button>
								<Button
									size="sm"
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
				<Button type="submit" variant="outline" disabled={busy || !guestName.trim()}>Add</Button>
			</form>

			{#if archivedGuests.length > 0}
				<div class="space-y-1">
					<p class="text-xs text-muted-foreground">Archived</p>
					{#each archivedGuests as driver (driver.id)}
						<div class="flex min-h-10 items-center justify-between gap-3 text-muted-foreground">
							<span class="truncate">{driver.name}</span>
							<Button
								size="sm"
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
		</CardContent>
	{/if}
</Card>
