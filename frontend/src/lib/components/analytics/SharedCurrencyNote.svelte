<script lang="ts">
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsQueryCoverage } from '#lib/types/index.ts';

	let {
		coverage,
		currency,
		class: className = ''
	}: { coverage?: AnalyticsQueryCoverage; currency?: string | null; class?: string } = $props();

	let currencies = $derived([...new Set((coverage?.otherCurrency ?? []).map(c => c.currency))]);
	let shownIn = $derived(
		currency === undefined ? (settingsStore.settings?.currencyUnit ?? 'USD') : currency
	);
	const listOf = (items: string[]) =>
		new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(items);
</script>

{#if currencies.length > 0}
	<p class="text-sm text-muted-foreground {className}">
		Not included: cars shared with you in {listOf(currencies)}.{shownIn
			? ` These figures are in ${shownIn}.`
			: ''}
	</p>
{/if}
