<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { Users, Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { shareApi } from '#lib/services/share-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { shareLevelLabel } from '#lib/utils/share-helpers.ts';
	import { formatDate } from '#lib/utils/formatters.ts';
	import type { GrantedShare, ShareLevel, VehicleShare } from '#lib/types/index.ts';

	interface Props {
		open: boolean;
		vehicleId: string | null;
		vehicleName: string;
	}

	let { open = $bindable(), vehicleId, vehicleName }: Props = $props();

	let email = $state('');
	let level = $state<ShareLevel>('viewer');
	let inviting = $state(false);

	let isLoading = $state(false);
	let loadError = $state<string | null>(null);
	let shares = $state<GrantedShare[]>([]);
	const SHARE_STATUSES_WITH_ACCESS: VehicleShare['status'][] = ['pending', 'accepted'];
	let revokeConfirmOpen = $state(false);
	let revokingShare = $state<GrantedShare | null>(null);
	const personName = (share: GrantedShare) =>
		share.sharedWithName?.trim() || share.sharedWithEmail || null;
	const personLabel = (share: GrantedShare) =>
		personName(share) ?? `the invitation sent ${formatDate(share.createdAt)}`;
	const revokeDescription = (share: GrantedShare) =>
		share.status === 'accepted' && personName(share)
			? `${personName(share)} will no longer see “${vehicleName}” or its expenses. You can invite them again later.`
			: `The invitation ${personName(share) ? `to ${personName(share)}` : `sent ${formatDate(share.createdAt)}`} will be cancelled, so it can't be accepted. You can invite them again later.`;

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
			shares = all.filter(
				s => s.vehicleId === vehicleId && SHARE_STATUSES_WITH_ACCESS.includes(s.status)
			);
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load shares:', error);
			loadError = userFacingErrorMessage(error);
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
			toast.success(`Invited ${email.trim()} as ${shareLevelLabel(level).toLowerCase()}`);
			email = '';
			level = 'viewer';
			await load();
		} catch (error) {
			appStore.showError(`Couldn't send the invitation. ${userFacingErrorMessage(error)}`);
		} finally {
			inviting = false;
		}
	}

	async function changeLevel(share: VehicleShare, next: ShareLevel) {
		if (next === share.level) return;
		try {
			await shareApi.changeLevel(share.id, next);
			toast.success(`Changed to ${shareLevelLabel(next).toLowerCase()}`);
			await load();
		} catch (error) {
			appStore.showError(`Couldn't change the access level. ${userFacingErrorMessage(error)}`);
		}
	}

	function confirmRevoke(share: GrantedShare) {
		revokingShare = share;
		revokeConfirmOpen = true;
	}

	async function revoke() {
		if (!revokingShare) return;
		try {
			await shareApi.revoke(revokingShare.id);
			toast.success('Access revoked');
		} catch (error) {
			appStore.showError(`Couldn't revoke access. ${userFacingErrorMessage(error)}`);
			throw error;
		}
		await load();
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
						{shareLevelLabel(level)}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="viewer" label="Viewer">Viewer — can view only</Select.Item>
						<Select.Item value="editor" label="Editor">
							Editor — can view + add expenses
						</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<Button type="submit" class="w-full" disabled={inviting || !email.trim()}>
				{inviting ? 'Sending…' : 'Send invitation'}
			</Button>
		</form>

		<div class="mt-2 min-w-0">
			<h3 class="mb-2 text-sm font-medium text-muted-foreground">People with access</h3>
			{#if isLoading}
				<div class="space-y-2">
					{#each Array(2) as _, i (i)}
						<Skeleton class="h-12 w-full" />
					{/each}
				</div>
			{:else if loadError}
				<LoadErrorCard
					compact
					title="Couldn't load who has access"
					message={loadError}
					onRetry={load}
				/>
			{:else if shares.length > 0}
				<div class="divide-y rounded-md border">
					{#each shares as share (share.id)}
						<div class="flex items-center justify-between gap-3 px-3 py-2.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">
									{personName(share) ?? 'Invited'}
								</p>
								<p class="truncate text-xs text-muted-foreground">
									<span class="capitalize">{share.status}</span>{share.status === 'accepted' &&
									share.sharedWithEmail
										? ` · ${share.sharedWithEmail}`
										: ` · sent ${formatDate(share.createdAt)}`}
								</p>
							</div>
							<div class="flex items-center gap-2">
								<Select.Root
									type="single"
									value={share.level}
									onValueChange={v => changeLevel(share, v as ShareLevel)}
								>
									<Select.Trigger
										class="w-[110px]"
										aria-label="Change access level for {personLabel(share)}"
									>
										{shareLevelLabel(share.level)}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="viewer" label="Viewer">Viewer</Select.Item>
										<Select.Item value="editor" label="Editor">Editor</Select.Item>
									</Select.Content>
								</Select.Root>
								<Button
									variant="ghost"
									size="icon-lg"
									class="sm:size-9"
									onclick={() => confirmRevoke(share)}
									aria-label="Revoke access for {personLabel(share)}"
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

<ConfirmDialog
	bind:open={revokeConfirmOpen}
	title="Revoke access?"
	description={revokingShare ? revokeDescription(revokingShare) : ''}
	confirmLabel="Revoke"
	onConfirm={revoke}
/>
