<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { Users, CircleAlert, Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { shareApi } from '$lib/services/share-api';
	import { ApiError } from '$lib/utils/error-handling';
	import type { ShareLevel, VehicleShare } from '$lib/types';

	interface Props {
		open: boolean;
		/** The vehicle being shared (owner side); null when closed. */
		vehicleId: string | null;
		vehicleName: string;
	}

	let { open = $bindable(), vehicleId, vehicleName }: Props = $props();

	// Invite form
	let email = $state('');
	let level = $state<ShareLevel>('viewer');
	let inviting = $state(false);

	// Current-shares list (owner-side, scoped to THIS vehicle).
	let isLoading = $state(false);
	let loadError = $state<string | null>(null);
	let shares = $state<VehicleShare[]>([]);

	const levelLabel = (l: ShareLevel) => (l === 'editor' ? 'Editor' : 'Viewer');

	// Load the owner's granted shares whenever the dialog opens for a vehicle, filtered to this one
	// (the API returns shares across ALL my vehicles — scope client-side to the vehicle in view). Keyed
	// on open:vehicleId so re-opening a different vehicle re-fetches.
	let lastKey = $state('');
	$effect(() => {
		const key = `${open}:${vehicleId ?? ''}`;
		if (key === lastKey) return;
		lastKey = key;
		if (!open || !vehicleId) return;
		void load();
	});

	async function load() {
		if (!vehicleId) return;
		isLoading = true;
		loadError = null;
		try {
			const all = await shareApi.listGranted();
			shares = all.filter((s) => s.vehicleId === vehicleId);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load shares:', error);
			loadError = error instanceof Error ? error.message : 'Failed to load shares';
		} finally {
			isLoading = false;
		}
	}

	async function invite(event: SubmitEvent) {
		event.preventDefault();
		if (!vehicleId || !email.trim()) return;
		inviting = true;
		try {
			await shareApi.invite({ vehicleId, email: email.trim(), level });
			toast.success(`Invited ${email.trim()} as ${levelLabel(level).toLowerCase()}`);
			email = '';
			level = 'viewer';
			await load();
		} catch (error) {
			// Surface the backend's specific message (no account / already shared / not your vehicle).
			const msg =
				error instanceof ApiError ? error.message : 'Could not send the invitation. Try again.';
			toast.error(msg);
		} finally {
			inviting = false;
		}
	}

	async function changeLevel(share: VehicleShare, next: ShareLevel) {
		if (next === share.level) return;
		try {
			await shareApi.changeLevel(share.id, next);
			toast.success(`Changed to ${levelLabel(next).toLowerCase()}`);
			await load();
		} catch {
			toast.error('Could not change the level. Try again.');
		}
	}

	async function revoke(share: VehicleShare) {
		try {
			await shareApi.revoke(share.id);
			toast.success('Access revoked');
			await load();
		} catch {
			toast.error('Could not revoke access. Try again.');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Users class="h-5 w-5" aria-hidden="true" />
				Share vehicle
			</Dialog.Title>
			<Dialog.Description>
				Invite another VROOM user to “{vehicleName}”. They accept before it appears in their fleet.
			</Dialog.Description>
		</Dialog.Header>

		<!-- Invite form -->
		<form class="space-y-3" onsubmit={invite}>
			<div class="space-y-1.5">
				<Label for="share-email">Invitee email</Label>
				<Input
					id="share-email"
					type="email"
					bind:value={email}
					placeholder="person@example.com"
					autocomplete="off"
					required
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="share-level">Access level</Label>
				<Select.Root type="single" bind:value={level}>
					<Select.Trigger id="share-level" class="w-full">
						{levelLabel(level)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="viewer" label="Viewer">Viewer — can view only</Select.Item>
						<Select.Item value="editor" label="Editor"
							>Editor — can view + add expenses</Select.Item
						>
					</Select.Content>
				</Select.Root>
			</div>
			<Button type="submit" class="w-full" disabled={inviting || !email.trim()}>
				{inviting ? 'Sending…' : 'Send invitation'}
			</Button>
		</form>

		<!-- Current shares -->
		<div class="mt-2">
			<h3 class="mb-2 text-sm font-medium text-muted-foreground">People with access</h3>
			{#if isLoading}
				<div class="space-y-2">
					{#each Array(2) as _, i (i)}
						<Skeleton class="h-12 w-full" />
					{/each}
				</div>
			{:else if loadError}
				<div class="rounded-lg border bg-card p-4">
					<div class="mb-2 flex items-center gap-2 text-destructive">
						<CircleAlert class="h-5 w-5" />
						<p class="font-medium">Failed to load shares</p>
					</div>
					<p class="mb-3 text-sm text-muted-foreground">{loadError}</p>
					<Button onclick={load}>Retry</Button>
				</div>
			{:else if shares.length > 0}
				<div class="divide-y rounded-md border">
					{#each shares as share (share.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{share.sharedWithId}</p>
								<p class="text-xs text-muted-foreground capitalize">{share.status}</p>
							</div>
							<div class="flex items-center gap-2">
								<Select.Root
									type="single"
									value={share.level}
									onValueChange={(v) => changeLevel(share, v as ShareLevel)}
								>
									<Select.Trigger
										class="h-8 w-[110px]"
										aria-label="Change access level for {share.sharedWithId}"
									>
										{levelLabel(share.level)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="viewer" label="Viewer">Viewer</Select.Item>
										<Select.Item value="editor" label="Editor">Editor</Select.Item>
									</Select.Content>
								</Select.Root>
								<Button
									variant="ghost"
									size="icon"
									onclick={() => revoke(share)}
									aria-label="Revoke access for {share.sharedWithId}"
								>
									<Trash2 class="h-4 w-4 text-destructive" />
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<EmptyState>
					{#snippet icon()}
						<Users class="h-12 w-12 text-muted-foreground" />
					{/snippet}
					{#snippet title()}
						Not shared yet
					{/snippet}
					{#snippet description()}
						Invite someone above to give them access to this vehicle.
					{/snippet}
				</EmptyState>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
