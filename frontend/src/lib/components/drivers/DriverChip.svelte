<script lang="ts">
	import * as Select from '#lib/components/ui/select/index.ts';
	import { driverApi } from '#lib/services/driver-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import type { Driver } from '#lib/types/index.ts';
	import {
		defaultDriverId,
		driverColor,
		rememberDriver,
		showsDriverChip
	} from '#lib/utils/driver-helpers.ts';
	import { loadCachedVehicles } from '#lib/utils/offline-storage.ts';

	interface Props {
		vehicleId: string;
		value: string | null | undefined;
		id: string;
		label?: string;
		sharing?: boolean;
		entry?: { vehicleId: string; driverId: string | null };
	}

	let { vehicleId, value = $bindable(), id, label = 'Driver', sharing, entry }: Props = $props();

	const NONE = 'none';
	let drivers = $state<Driver[] | null>(null);
	let me = $derived(authStore.user?.id);
	let options = $derived((drivers ?? []).filter(d => !d.archived || d.id === value));
	let selected = $derived(options.find(d => d.id === value));

	async function loadDrivers(car: string, known: boolean | undefined): Promise<Driver[] | null> {
		try {
			const cached = showsDriverChip(loadCachedVehicles().find(v => v.id === car));
			const on = known ?? cached ?? showsDriverChip(await vehicleApi.getVehicle(car));
			return on ? await driverApi.list(car) : null;
		} catch {
			return null;
		}
	}

	$effect(() => {
		const car = vehicleId;
		const onEntryCar = !!entry && car === entry.vehicleId;
		drivers = null;
		value = onEntryCar && entry ? entry.driverId : undefined;
		if (!car) return;
		let stale = false;
		void loadDrivers(car, sharing).then(list => {
			if (stale) return;
			drivers = list;
			if (list && !onEntryCar) value = defaultDriverId(car, list, authStore.user?.id);
		});
		return () => {
			stale = true;
		};
	});

	function pick(next: string) {
		value = next === NONE ? null : next;
		if (!entry) rememberDriver(vehicleId, value);
	}
</script>

{#snippet dot(driver: Driver)}
	<span
		class="size-2.5 shrink-0 rounded-full"
		style:background-color={driverColor(driver)}
		aria-hidden="true"
	></span>
{/snippet}

{#if drivers && options.length > 0}
	<Select.Root type="single" value={value ?? NONE} onValueChange={pick}>
		<Select.Trigger {id} aria-label="{label}: {selected?.name ?? 'No one'}" class="rounded-full">
			<span class="text-muted-foreground">{label}</span>
			{#if selected}
				{@render dot(selected)}
				{selected.name}
			{:else}
				No one
			{/if}
		</Select.Trigger>
		<Select.Content>
			{#each options as driver (driver.id)}
				<Select.Item value={driver.id} label={driver.name}>
					{@render dot(driver)}
					{driver.name}
					{#if me && driver.userId === me}<span class="text-muted-foreground">(you)</span>
					{:else if driver.guest}<span class="text-muted-foreground">· guest</span>{/if}
				</Select.Item>
			{/each}
			<Select.Item value={NONE} label="No one">No one</Select.Item>
		</Select.Content>
	</Select.Root>
{/if}
