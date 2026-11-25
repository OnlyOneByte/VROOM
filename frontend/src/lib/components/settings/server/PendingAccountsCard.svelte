<script lang="ts">
	import { onMount } from 'svelte';
	import { LoaderCircle, UserCheck } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { signupApi, type PendingAccount } from '#lib/services/signup-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatDate } from '#lib/utils/formatters.ts';

	let accounts = $state<PendingAccount[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let rejecting = $state<PendingAccount | null>(null);
	let confirmReject = $state(false);

	onMount(async () => {
		try {
			accounts = await signupApi.listPending();
		} catch (e) {
			loadError = `Couldn't load waiting accounts. ${userFacingErrorMessage(e)}`;
		} finally {
			loading = false;
		}
	});

	function drop(id: string) {
		accounts = accounts.filter(a => a.id !== id);
	}

	async function approve(account: PendingAccount) {
		busyId = account.id;
		try {
			await signupApi.approve(account.id);
			drop(account.id);
			appStore.showSuccess(`${account.displayName} can now use VROOM`);
		} catch (e) {
			appStore.showError(`Couldn't approve ${account.email}. ${userFacingErrorMessage(e)}`);
		} finally {
			busyId = null;
		}
	}

	function askReject(account: PendingAccount) {
		rejecting = account;
		confirmReject = true;
	}

	async function reject() {
		if (!rejecting) return;
		const account = rejecting;
		try {
			await signupApi.reject(account.id);
			drop(account.id);
			appStore.showSuccess(`Removed ${account.email}`);
		} catch (e) {
			appStore.showError(`Couldn't remove ${account.email}. ${userFacingErrorMessage(e)}`);
			throw e;
		}
	}
</script>

<Card id="pending-accounts">
	<CardHeader>
		<div class="flex items-center gap-2">
			<UserCheck class="h-5 w-5 text-muted-foreground" />
			<CardTitle level={2}>Waiting for approval</CardTitle>
		</div>
		<CardDescription>
			People who signed up while sign-up needed approval. They can't see or add anything yet.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if loading}
			<div class="flex justify-center py-4">
				<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if loadError}
			<p class="text-sm text-destructive" role="alert">{loadError}</p>
		{:else if accounts.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="pending-empty">Nobody is waiting.</p>
		{:else}
			<ul class="divide-y" data-testid="pending-list">
				{#each accounts as account (account.id)}
					<li class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 py-2">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{account.displayName}</p>
							<p class="truncate text-xs text-muted-foreground">
								{account.email}{account.pendingSince
									? ` · since ${formatDate(account.pendingSince)}`
									: ''}
							</p>
						</div>
						<div class="flex gap-2">
							<Button
								variant="ghost"
								class="h-10 text-destructive sm:h-9"
								disabled={busyId !== null}
								onclick={() => askReject(account)}
								aria-label="Reject {account.email}"
							>
								Reject
							</Button>
							<Button
								class="h-10 sm:h-9"
								disabled={busyId !== null}
								onclick={() => void approve(account)}
								aria-label="Approve {account.email}"
							>
								{#if busyId === account.id}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
								Approve
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={confirmReject}
	title="Reject this sign-up?"
	description="{rejecting?.email ??
		'This account'} is deleted. They can try again later if sign-up allows it."
	confirmLabel="Reject"
	onConfirm={reject}
/>
