<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { LoaderCircle, Mail } from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { signupApi, type InviteStatus, type ServerInvite } from '#lib/services/signup-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatDate } from '#lib/utils/formatters.ts';

	interface Props {
		closed: boolean;
	}

	let { closed }: Props = $props();

	const STATUS: Record<InviteStatus, { label: string; variant: BadgeVariant }> = {
		active: { label: 'Open', variant: 'default' },
		used: { label: 'Used', variant: 'secondary' },
		expired: { label: 'Expired', variant: 'outline' },
		revoked: { label: 'Revoked', variant: 'outline' }
	};

	let invites = $state<ServerInvite[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let email = $state('');
	let days = $state(7);
	let creating = $state(false);
	let formError = $state<string | null>(null);
	let emailInput = $state<HTMLInputElement | null>(null);
	let revoking = $state<ServerInvite | null>(null);
	let confirmRevoke = $state(false);

	onMount(async () => {
		try {
			invites = await signupApi.listInvites();
		} catch (e) {
			loadError = `Couldn't load invites. ${userFacingErrorMessage(e)}`;
		} finally {
			loading = false;
		}
	});

	async function createInvite(event: SubmitEvent) {
		event.preventDefault();
		formError = null;
		if (!email.trim()) {
			formError = 'Enter the email to invite.';
			await tick();
			emailInput?.focus();
			return;
		}
		creating = true;
		try {
			const invite = await signupApi.createInvite(email.trim(), days);
			invites = [invite, ...invites];
			email = '';
			appStore.showSuccess(`Invited ${invite.email}`);
		} catch (e) {
			formError = userFacingErrorMessage(e);
			await tick();
			emailInput?.focus();
		} finally {
			creating = false;
		}
	}

	function askRevoke(invite: ServerInvite) {
		revoking = invite;
		confirmRevoke = true;
	}

	async function revoke() {
		if (!revoking) return;
		try {
			const updated = await signupApi.revokeInvite(revoking.id);
			invites = invites.map(i => (i.id === updated.id ? updated : i));
			appStore.showSuccess('Invite revoked');
		} catch (e) {
			appStore.showError(`Couldn't revoke the invite. ${userFacingErrorMessage(e)}`);
			throw e;
		}
	}
</script>

<Card id="server-invites">
	<CardHeader>
		<div class="flex items-center gap-2">
			<Mail class="h-5 w-5 text-muted-foreground" />
			<CardTitle level={2}>Invites</CardTitle>
		</div>
		<CardDescription>
			An invite lets one email sign up once, before it expires. Tell the person yourself: VROOM
			doesn't send email.
		</CardDescription>
	</CardHeader>
	<CardContent class="space-y-5">
		{#if closed}
			<p class="text-sm text-muted-foreground" data-testid="invites-closed">
				Sign-up is closed, so invites don't admit anyone right now.
			</p>
		{/if}
		<form class="space-y-2" onsubmit={createInvite} novalidate>
			<div class="grid gap-2 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
				<div class="space-y-1.5">
					<Label for="invite-email">Email</Label>
					<Input
						id="invite-email"
						type="email"
						bind:ref={emailInput}
						bind:value={email}
						placeholder="name@example.com"
						autocomplete="off"
						aria-invalid={formError ? 'true' : undefined}
						aria-describedby={formError ? 'invite-error' : undefined}
						disabled={creating}
					/>
				</div>
				<div class="space-y-1.5">
					<Label for="invite-days">Expires in (days)</Label>
					<Input
						id="invite-days"
						type="number"
						min={1}
						max={90}
						bind:value={days}
						disabled={creating}
					/>
				</div>
				<Button type="submit" class="h-10 sm:h-9" disabled={creating}>
					{#if creating}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
					Invite
				</Button>
			</div>
			{#if formError}
				<p id="invite-error" class="text-sm text-destructive" role="alert">{formError}</p>
			{/if}
		</form>

		{#if loading}
			<div class="flex justify-center py-4">
				<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if loadError}
			<p class="text-sm text-destructive" role="alert">{loadError}</p>
		{:else if invites.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="invites-empty">No invites yet.</p>
		{:else}
			<ul class="divide-y" data-testid="invite-list">
				{#each invites as invite (invite.id)}
					<li class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{invite.email}</p>
							<p class="text-xs text-muted-foreground">
								{#if invite.status === 'used' && invite.usedAt}
									Used {formatDate(invite.usedAt)}
								{:else if invite.status === 'revoked' && invite.revokedAt}
									Revoked {formatDate(invite.revokedAt)}
								{:else if invite.status === 'expired'}
									Expired {formatDate(invite.expiresAt)}
								{:else}
									Expires {formatDate(invite.expiresAt)}
								{/if}
							</p>
						</div>
						<Badge variant={STATUS[invite.status].variant}>{STATUS[invite.status].label}</Badge>
						{#if invite.status === 'active'}
							<Button
								variant="ghost"
								class="h-10 text-destructive sm:h-9"
								onclick={() => askRevoke(invite)}
								aria-label="Revoke the invite for {invite.email}"
							>
								Revoke
							</Button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={confirmRevoke}
	title="Revoke this invite?"
	description="{revoking?.email ??
		'This email'} can no longer use it to sign up. You can invite them again later."
	confirmLabel="Revoke"
	onConfirm={revoke}
/>
