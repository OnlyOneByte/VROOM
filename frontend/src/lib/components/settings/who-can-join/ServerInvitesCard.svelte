<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { LoaderCircle, Mail } from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import * as Empty from '#lib/components/ui/empty/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { signupApi, type InviteStatus, type ServerInvite } from '#lib/services/signup-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatDate } from '#lib/utils/formatters.ts';

	interface Props {
		closed: boolean;
	}

	let { closed }: Props = $props();

	const MAX_DAYS = 90;
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
	let days = $state<number | null>(7);
	let creating = $state(false);
	let emailError = $state<string | null>(null);
	let daysError = $state<string | null>(null);
	let emailInput = $state<HTMLInputElement | null>(null);
	let daysInput = $state<HTMLInputElement | null>(null);
	let revoking = $state<ServerInvite | null>(null);
	let confirmRevoke = $state(false);

	async function load() {
		loadError = null;
		try {
			invites = await signupApi.listInvites();
		} catch (e) {
			logLoadFailure(e, "Couldn't load invites");
			loadError = userFacingErrorMessage(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function focusField(input: HTMLInputElement | null) {
		await tick();
		input?.focus();
	}

	async function createInvite(event: SubmitEvent) {
		event.preventDefault();
		if (creating) return;
		emailError = null;
		daysError = null;
		if (!email.trim()) {
			emailError = 'Enter the email to invite.';
			return focusField(emailInput);
		}
		if (days === null || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
			daysError = `Enter a whole number of days from 1 to ${MAX_DAYS}.`;
			return focusField(daysInput);
		}
		creating = true;
		try {
			const invite = await signupApi.createInvite(email.trim(), days);
			invites = [invite, ...invites];
			email = '';
			appStore.showSuccess(`Invited ${invite.email}`);
		} catch (e) {
			emailError = userFacingErrorMessage(e);
			await focusField(emailInput);
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

	function focusAfterRevoke(event: Event) {
		if (invites.find(i => i.id === revoking?.id)?.status === 'active') return;
		event.preventDefault();
		emailInput?.focus();
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
			<div class="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-start">
				<div class="space-y-1.5">
					<Label for="invite-email">Email *</Label>
					<Input
						id="invite-email"
						type="email"
						required
						bind:ref={emailInput}
						bind:value={email}
						placeholder="name@example.com"
						autocomplete="off"
						aria-invalid={emailError ? 'true' : undefined}
						aria-describedby={emailError ? 'invite-email-error' : undefined}
					/>
					{#if emailError}
						<FormFieldError id="invite-email-error">{emailError}</FormFieldError>
					{/if}
				</div>
				<div class="space-y-1.5">
					<Label for="invite-days">Expires in (days)</Label>
					<Input
						id="invite-days"
						type="number"
						min={1}
						max={MAX_DAYS}
						bind:ref={daysInput}
						bind:value={days}
						aria-invalid={daysError ? 'true' : undefined}
						aria-describedby={daysError ? 'invite-days-error' : undefined}
					/>
					{#if daysError}
						<FormFieldError id="invite-days-error">{daysError}</FormFieldError>
					{/if}
				</div>
				<Button type="submit" class="h-10 sm:mt-[1.375rem] sm:h-9" aria-busy={creating}>
					{#if creating}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
					Invite
				</Button>
			</div>
		</form>

		{#if loading}
			<div class="space-y-3" data-testid="invites-loading">
				{#each [0, 1] as row (row)}
					<div class="flex min-h-12 items-center gap-3 py-2">
						<div class="flex-1 space-y-1.5">
							<Skeleton class="h-4 w-48" />
							<Skeleton class="h-3 w-28" />
						</div>
						<Skeleton class="h-5 w-12 rounded-full" />
					</div>
				{/each}
			</div>
		{:else if loadError}
			<LoadErrorCard compact title="Couldn't load invites" message={loadError} onRetry={load} />
		{:else if invites.length === 0}
			<Empty.Root class="p-4 md:p-6" data-testid="invites-empty">
				<Empty.Header>
					<Empty.Title>No invites yet</Empty.Title>
					<Empty.Description>Invite someone above to let them sign up.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
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
	onCloseAutoFocus={focusAfterRevoke}
/>
