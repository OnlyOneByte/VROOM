<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		open: boolean;
		backupProvidersEnabled: boolean;
		onSync: () => void;
	}

	let {
		open = $bindable(),
		backupProvidersEnabled,
		onSync
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Backup Now</Dialog.Title>
			<Dialog.Description>Run a backup to all enabled providers</Dialog.Description>
		</Dialog.Header>

		<div class="py-4">
			{#if !backupProvidersEnabled}
				<p class="text-sm text-muted-foreground">
					Enable backup on a storage provider first to use cloud backup.
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					This will back up your data to all enabled providers. You can continue using the app while
					the backup runs.
				</p>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={onSync} disabled={!backupProvidersEnabled}>
				<RefreshCw class="mr-2 h-4 w-4" />
				Backup Now
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
