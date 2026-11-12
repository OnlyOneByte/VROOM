<script lang="ts">
	import { onMount } from 'svelte';
	import { Inbox, Check, X, CircleAlert } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { toast } from 'svelte-sonner';
	import { shareApi } from '$lib/services/share-api';
	import { ApiError } from '$lib/utils/error-handling';
	import { shareLevelLabel } from '$lib/utils/share-helpers';
	import type { ReceivedShare } from '$lib/types';

	interface Props {
		onAccepted?: () => void;
	}

	let { onAccepted }: Props = $props();

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let pending = $state<ReceivedShare[]>([]);
	let acting = $state<string | null>(null);

	onMount(load);

	async function load() {
		isLoading = true;
		loadError = null;
		try {
			const received = await shareApi.listReceived();
			pending = received.filter(s => s.status === 'pending');
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load invitations:', error);
			loadError = error instanceof Error ? error.message : 'Failed to load invitations';
		} finally {
			isLoading = false;
		}
	}

	async function accept(share: ReceivedShare) {
		acting = share.id;
		try {
			await shareApi.accept(share.id);
			toast.success(`Accepted access to ${share.vehicleName}`);
			pending = pending.filter(s => s.id !== share.id);
			onAccepted?.();
		} catch (error) {
			const msg =
				error instanceof ApiError ? error.message : 'Could not accept the invitation. Try again.';
			toast.error(msg);
		} finally {
			acting = null;
		}
	}

	async function decline(share: ReceivedShare) {
		acting = share.id;
		try {
			await shareApi.decline(share.id);
			toast.success(`Declined the invitation to ${share.vehicleName}`);
			pending = pending.filter(s => s.id !== share.id);
		} catch (error) {
			const msg =
				error instanceof ApiError ? error.message : 'Could not decline the invitation. Try again.';
			toast.error(msg);
		} finally {
			acting = null;
		}
	}
</script>

{#if loadError && !isLoading}
	<Card.Root>
		<Card.Content class="p-4">
			<div class="mb-2 flex items-center gap-2 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Could not load your invitations</p>
			</div>
			<p class="mb-3 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={load}>Retry</Button>
		</Card.Content>
	</Card.Root>
{:else if pending.length > 0}
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Shared with you</Card.Title>
					<Card.Description>Vehicles other people invited you to</Card.Description>
				</div>
				<div class="p-2 rounded-lg bg-accent">
					<Inbox class="h-5 w-5 text-accent-foreground" />
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			<div class="space-y-3">
				{#each pending as share (share.id)}
					<div class="flex items-center justify-between gap-3 p-3 rounded-lg border">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-medium truncate">{share.vehicleName}</span>
								<Badge variant="secondary" class="text-xs">{shareLevelLabel(share.level)}</Badge>
							</div>
							<p class="text-xs text-muted-foreground mt-1">Shared by {share.sharedBy}</p>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							<Button
								size="sm"
								onclick={() => accept(share)}
								disabled={acting === share.id}
								aria-label="Accept access to {share.vehicleName}"
							>
								<Check class="h-4 w-4 mr-1" />
								Accept
							</Button>
							<Button
								size="sm"
								variant="outline"
								onclick={() => decline(share)}
								disabled={acting === share.id}
								aria-label="Decline the invitation to {share.vehicleName}"
							>
								<X class="h-4 w-4 mr-1" />
								Decline
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</Card.Content>
	</Card.Root>
{/if}
