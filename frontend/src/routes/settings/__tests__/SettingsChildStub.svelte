<script lang="ts">
	let {
		distanceUnit = $bindable(),
		volumeUnit = $bindable(),
		currencyUnit = $bindable(),
		chargeUnit = $bindable(),
		syncInactivityMinutes = $bindable(),
		open = $bindable(),
		domain,
		onSync,
		onDownloadBackup
	}: {
		distanceUnit?: string;
		volumeUnit?: string;
		currencyUnit?: string;
		chargeUnit?: string;
		syncInactivityMinutes?: number;
		open?: boolean;
		domain?: string;
		onSync?: () => void;
		onDownloadBackup?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

{#if distanceUnit !== undefined}
	<input aria-label="stub distance" bind:value={distanceUnit} />
	<input aria-label="stub volume" bind:value={volumeUnit} />
	<input aria-label="stub currency" bind:value={currencyUnit} />
	<span data-testid="stub-charge">{chargeUnit}</span>
{/if}
{#if syncInactivityMinutes !== undefined}
	<input aria-label="stub inactivity" type="number" bind:value={syncInactivityMinutes} />
{/if}
{#if domain}
	<span data-testid="stub-model-{domain}"></span>
{/if}
{#if open}
	<span data-testid="stub-open"></span>
{/if}
{#if onSync}
	<button onclick={onSync}>stub sync</button>
{/if}
{#if onDownloadBackup}
	<button onclick={onDownloadBackup}>stub download</button>
{/if}
