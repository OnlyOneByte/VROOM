<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
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
	import { signupApi, type PendingAccount } from '#lib/services/signup-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatDate } from '#lib/utils/formatters.ts';

	let accounts = $state<PendingAccount[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let rejecting = $state<PendingAccount | null>(null);
	let confirmReject = $state(false);
	let list = $state<HTMLElement | null>(null);

	async function load() {
		loadError = null;
		try {
			accounts = await signupApi.listPending();
		} catch (e) {
			logLoadFailure(e, "Couldn't load waiting accounts");
			loadError = userFacingErrorMessage(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function drop(id: string) {
		accounts = accounts.filter(a => a.id !== id);
		await tick();
		const next = list?.querySelector<HTMLElement>('[data-approve]');
		(next ?? list)?.focus();
	}

	async function approve(account: PendingAccount) {
		busyId = account.id;
		try {
			await signupApi.approve(account.id);
			appStore.showSuccess(`${account.displayName} can now use VROOM`);
			busyId = null;
			await drop(account.id);
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
			accounts = accounts.filter(a => a.id !== account.id);
			appStore.showSuccess(`Removed ${account.email}`);
		} catch (e) {
			appStore.showError(`Couldn't remove ${account.email}. ${userFacingErrorMessage(e)}`);
			throw e;
		}
	}

	function focusAfterReject(event: Event) {
		if (accounts.some(a => a.id === rejecting?.id)) return;
		event.preventDefault();
		(list?.querySelector<HTMLElement>('[data-approve]') ?? list)?.focus();
	}
</script>

<Card
	variant="section"
	id="pending-accounts"
	role="region"
	aria-labelledby="pending-accounts-title"
>
	<CardHeader>
		<CardTitle level={2} id="pending-accounts-title" class="text-base">
			Waiting for approval
		</CardTitle>
		<CardDescription>
			People who signed up while sign-up needed approval. They can't see or add anything yet.
		</CardDescription>
	</CardHeader>
	<CardContent>
		<div bind:this={list} tabindex="-1" class="rounded-md outline-none">
			{#if loading}
				<div class="flex min-h-12 items-center gap-3 py-2" data-testid="pending-loading">
					<div class="flex-1 space-y-1.5">
						<Skeleton class="h-4 w-32" />
						<Skeleton class="h-3 w-52" />
					</div>
					<Skeleton class="h-9 w-24 rounded-full" />
				</div>
			{:else if loadError}
				<LoadErrorCard
					compact
					title="Couldn't load waiting accounts"
					message={loadError}
					onRetry={load}
				/>
			{:else if accounts.length === 0}
				<Empty.Root class="p-4 md:p-6" data-testid="pending-empty">
					<Empty.Header>
						<Empty.Title>Nobody is waiting</Empty.Title>
						<Empty.Description>
							New sign-ups show up here while sign-up needs approval.
						</Empty.Description>
					</Empty.Header>
				</Empty.Root>
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
							<div class="flex w-full justify-end gap-2 sm:w-auto">
								<Button
									variant="ghost"
									class="h-10 text-destructive"
									disabled={busyId !== null}
									onclick={() => askReject(account)}
									aria-label="Reject {account.email}"
								>
									Reject
								</Button>
								<Button
									variant="outline"
									class="h-10"
									data-approve
									aria-busy={busyId === account.id}
									disabled={busyId !== null && busyId !== account.id}
									onclick={() => void (busyId === null && approve(account))}
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
		</div>
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={confirmReject}
	title="Reject this sign-up?"
	description="{rejecting?.email ??
		'This account'} is deleted. They can try again later if sign-up allows it."
	confirmLabel="Reject"
	onConfirm={reject}
	onCloseAutoFocus={focusAfterReject}
/>
