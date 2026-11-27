<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		open: boolean;
		backupProvidersEnabled: boolean;
		providers?: Array<{ id: string; displayName: string }>;
		onSync: () => void;
	}

	let { open = $bindable(), backupProvidersEnabled, providers = [], onSync }: Props = $props();

	let confirmLabel = $derived(
		providers.length === 0
			? 'Back up now'
			: `Back up to ${providers.length} provider${providers.length === 1 ? '' : 's'}`
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Back up now</Dialog.Title>
			<Dialog.Description>
				{#if backupProvidersEnabled}
					Send a fresh backup to your storage. You can keep using VROOM while it runs.
				{:else}
					Turn on backups for a storage provider first.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if backupProvidersEnabled && providers.length > 0}
			<ul class="divide-y" aria-label="Backups go to">
				{#each providers as provider (provider.id)}
					<li class="py-3">
						<p class="font-medium">{provider.displayName}</p>
						<p class="text-sm text-muted-foreground">Backups on</p>
					</li>
				{/each}
			</ul>
		{/if}

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={onSync} disabled={!backupProvidersEnabled}>
				<RefreshCw aria-hidden="true" />
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
