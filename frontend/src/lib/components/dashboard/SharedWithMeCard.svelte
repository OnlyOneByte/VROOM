<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { Check, X } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { toast } from 'svelte-sonner';
	import { shareApi } from '#lib/services/share-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { shareLevelLabel } from '#lib/utils/share-helpers.ts';
	import type { ReceivedShare } from '#lib/types/index.ts';

	interface Props {
		pending: ReceivedShare[];
		loadError: string | null;
		onRetry: () => void;
		onAccepted: (_share: ReceivedShare) => void;
		onDeclined: (_share: ReceivedShare) => void;
	}

	let { pending, loadError, onRetry, onAccepted, onDeclined }: Props = $props();

	let acting = $state<string | null>(null);

	async function accept(share: ReceivedShare) {
		acting = share.id;
		try {
			await shareApi.accept(share.id);
			toast.success(`Accepted access to ${share.vehicleName}`);
			onAccepted(share);
		} catch (error) {
			appStore.showError(`Couldn't accept the invitation. ${userFacingErrorMessage(error)}`);
		} finally {
			acting = null;
		}
	}

	async function decline(share: ReceivedShare) {
		acting = share.id;
		try {
			await shareApi.decline(share.id);
			toast.success(`Declined the invitation to ${share.vehicleName}`);
			onDeclined(share);
		} catch (error) {
			appStore.showError(`Couldn't decline the invitation. ${userFacingErrorMessage(error)}`);
		} finally {
			acting = null;
		}
	}
</script>

{#if loadError}
	<LoadErrorCard compact title="Couldn't load your invitations" message={loadError} {onRetry} />
{:else if pending.length > 0}
	<Card.Root class="gap-3 py-5" data-testid="shared-with-you">
		<Card.Header class="px-5">
			<Card.Title level={2} class="text-lg">Shared with you</Card.Title>
		</Card.Header>
		<Card.Content class="px-5">
			<ul class="divide-y" role="list">
				{#each pending as share (share.id)}
					<li
						class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-foreground">{share.vehicleName}</p>
							<p class="text-xs text-muted-foreground">
								{shareLevelLabel(share.level)} · Shared by {share.sharedBy}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Button
								size="sm"
								class="h-10 sm:h-8"
								onclick={() => accept(share)}
								disabled={acting === share.id}
								aria-label="Accept access to {share.vehicleName}"
							>
								<Check class="h-4 w-4" />
								Accept
							</Button>
							<Button
								size="sm"
								variant="outline"
								class="h-10 sm:h-8"
								onclick={() => decline(share)}
								disabled={acting === share.id}
								aria-label="Decline the invitation to {share.vehicleName}"
							>
								<X class="h-4 w-4" />
								Decline
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		</Card.Content>
	</Card.Root>
{/if}
