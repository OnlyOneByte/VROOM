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
		onDownloadBackup,
		onBackupNow,
		onRestore,
		onUnitsChange,
		onCurrencyChange,
		onSyncInactivityChange
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
		onBackupNow?: () => void;
		onRestore?: () => void;
		onUnitsChange?: () => void;
		onCurrencyChange?: () => void;
		onSyncInactivityChange?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

{#if distanceUnit !== undefined}
	<input aria-label="stub distance" bind:value={distanceUnit} onchange={() => onUnitsChange?.()} />
	<input aria-label="stub volume" bind:value={volumeUnit} onchange={() => onUnitsChange?.()} />
	<input
		aria-label="stub currency"
		bind:value={currencyUnit}
		onchange={() => onCurrencyChange?.()}
	/>
	<span data-testid="stub-charge">{chargeUnit}</span>
{/if}
{#if syncInactivityMinutes !== undefined}
	<input
		aria-label="stub inactivity"
		type="number"
		bind:value={syncInactivityMinutes}
		onchange={() => onSyncInactivityChange?.()}
	/>
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
{#if onBackupNow}
	<button onclick={onBackupNow}>stub backup now</button>
{/if}
{#if onRestore}
	<button onclick={onRestore}>stub restore</button>
{/if}
