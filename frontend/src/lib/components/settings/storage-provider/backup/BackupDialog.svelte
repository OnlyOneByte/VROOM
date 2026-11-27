<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		open: boolean;
		providers?: Array<{ id: string; displayName: string; savedOn: boolean }>;
		onSync: (_providerIds?: string[]) => void;
	}

	let { open = $bindable(), providers = [], onSync }: Props = $props();

	let chosen = $state<Record<string, boolean>>({});

	$effect(() => {
		if (!open) return;
		untrack(() => {
			chosen = Object.fromEntries(providers.map(p => [p.id, p.savedOn]));
		});
	});

	const isChosen = (provider: { id: string; savedOn: boolean }) =>
		chosen[provider.id] ?? provider.savedOn;

	let chosenIds = $derived(providers.filter(isChosen).map(p => p.id));
	let changed = $derived(providers.some(p => isChosen(p) !== p.savedOn));

	let confirmLabel = $derived(
		chosenIds.length === 0
			? 'Back up now'
			: `Back up to ${chosenIds.length} provider${chosenIds.length === 1 ? '' : 's'}`
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Back up now</Dialog.Title>
			<Dialog.Description>
				{#if providers.length > 0}
					Choose where this backup goes. Your saved backup settings stay as they are.
				{:else}
					Connect a storage provider that can hold backups first.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if providers.length > 0}
			<ul class="divide-y" aria-label="Backups go to">
				{#each providers as provider (provider.id)}
					<li class="flex items-center justify-between gap-4 py-3">
						<div class="min-w-0">
							<p class="font-medium">{provider.displayName}</p>
							<p class="text-sm text-muted-foreground">
								{provider.savedOn ? 'Backups on' : 'Backups off'}
							</p>
						</div>
						<Switch
							checked={isChosen(provider)}
							onCheckedChange={checked => (chosen = { ...chosen, [provider.id]: checked })}
							aria-label="Back up to {provider.displayName}"
						/>
					</li>
				{/each}
			</ul>
		{/if}

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button
				onclick={() => onSync(changed ? chosenIds : undefined)}
				disabled={chosenIds.length === 0}
			>
				<RefreshCw aria-hidden="true" />
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
