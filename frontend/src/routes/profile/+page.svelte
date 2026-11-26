<script lang="ts">
	import { formatDateWith } from '#lib/utils/formatters.ts';
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { page } from '$app/state';
	import { browser } from '$app/env';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { authApi } from '#lib/services/auth-api.ts';
	import { getApiBaseUrl } from '#lib/services/api-client.ts';
	import type { LinkedAuthProvider } from '#lib/types/index.ts';
	import {
		Monitor,
		Users,
		Bell,
		LogOut,
		UserPlus,
		Clock,
		LoaderCircle,
		TriangleAlert,
		CircleCheck,
		Check,
		X
	} from '@lucide/svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import ComingSoonCard from '#lib/components/common/coming-soon-card.svelte';
	import { authProviderHasLogo, authProviderIcon } from '#lib/constants/auth-providers.ts';

	const linkErrorMessages: Record<string, string> = {
		account_conflict: 'This account is already linked to a different user.',
		already_linked: 'This account is already linked to your profile.',
		cancelled: 'Linking was cancelled.',
		invalid_state: 'The linking session expired. Please try again.',
		session_mismatch:
			'You were signed in as someone else when linking finished. Sign in again and retry.',
		unknown_provider: 'This sign-in method is not supported.',
		forbidden: "You don't have permission to link sign-in methods.",
		no_email:
			"We couldn't retrieve your email from this provider. Please check your provider's privacy settings.",
		provider_unavailable: 'The sign-in provider is temporarily unavailable. Please try again.'
	};

	const successMessages: Record<string, string> = {
		linked: 'Account linked successfully.'
	};

	let user = $derived(authStore.user);

	let accounts = $state<LinkedAuthProvider[]>([]);
	let providers = $state<{ id: string; displayName: string }[]>([]);
	let isLoadingAccounts = $state(true);
	let unlinkingId = $state<string | null>(null);
	let unlinkError = $state<string | null>(null);
	let unlinkConfirmOpen = $state(false);
	let pendingUnlink = $state<LinkedAuthProvider | null>(null);
	let linkingProvider = $state<string | null>(null);

	let isEditingName = $state(false);
	let nameDraft = $state('');
	let isSavingName = $state(false);

	onMount(() => trackPendingSave(() => isSavingName));

	function startEditName() {
		nameDraft = user?.displayName ?? '';
		isEditingName = true;
	}

	function cancelEditName() {
		isEditingName = false;
	}

	async function saveDisplayName() {
		const trimmed = nameDraft.trim();
		if (trimmed.length < 1 || trimmed.length > 100) {
			appStore.showError('Display name must be between 1 and 100 characters');
			return;
		}
		if (trimmed === user?.displayName) {
			isEditingName = false;
			return;
		}
		isSavingName = true;
		try {
			await authStore.updateDisplayName(trimmed);
			appStore.showSuccess('Display name updated');
			isEditingName = false;
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to update display name:', err);
			appStore.showError(`Couldn't update your display name. ${userFacingErrorMessage(err)}`);
		} finally {
			isSavingName = false;
		}
	}

	const linkError = $derived(page.url.searchParams.get('link_error'));
	const linkErrorMessage = $derived(linkError ? (linkErrorMessages[linkError] ?? null) : null);
	const successParam = $derived(page.url.searchParams.get('success'));
	const successMessage = $derived(successParam ? (successMessages[successParam] ?? null) : null);
	const linkedProviderTypes = $derived(new Set(accounts.map(a => a.providerType)));
	const unlinkableProviders = $derived(providers.filter(p => !linkedProviderTypes.has(p.id)));

	let initials = $derived.by(() => {
		if (!user?.displayName) return '?';

		return user.displayName
			.split(' ')
			.map(n => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	});

	let memberSince = $derived.by(() => {
		if (!user?.createdAt) return '';
		return formatDateWith(new Date(user.createdAt), {
			month: 'long',
			year: 'numeric'
		});
	});

	onMount(async () => {
		try {
			const [fetchedAccounts, fetchedProviders] = await Promise.all([
				authApi.getLinkedAccounts(),
				authApi.getProviders()
			]);
			accounts = fetchedAccounts;
			providers = fetchedProviders;
		} catch {
			// Accounts section falls back to empty.
		} finally {
			isLoadingAccounts = false;
		}
	});

	function confirmUnlink(account: LinkedAuthProvider) {
		pendingUnlink = account;
		unlinkConfirmOpen = true;
	}

	async function handleUnlink(id: string) {
		unlinkingId = id;
		unlinkError = null;
		try {
			await authApi.unlinkAccount(id);
			accounts = accounts.filter(a => a.id !== id);
		} catch (err) {
			const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
			if (code === 'LAST_ACCOUNT') {
				unlinkError = "You can't unlink your last sign-in method.";
			} else {
				unlinkError = `Couldn't unlink the account. ${userFacingErrorMessage(err)}`;
			}
		} finally {
			unlinkingId = null;
		}
	}

	function handleLink(providerId: string) {
		if (browser) {
			linkingProvider = providerId;
			window.location.href = `${getApiBaseUrl()}/auth/link/${providerId}`;
		}
	}

	let isExporting = $state(false);

	async function handleExportData() {
		isExporting = true;
		try {
			await settingsStore.downloadBackup();
			appStore.showSuccess('Data export downloaded');
		} catch (err) {
			if (import.meta.env.DEV) console.error('Failed to export data:', err);
			appStore.showError(`Couldn't export your data. ${userFacingErrorMessage(err)}`);
		} finally {
			isExporting = false;
		}
	}
</script>

<svelte:head>
	<title>Profile - VROOM Car Tracker</title>
	<meta name="description" content="Manage your profile and account" />
</svelte:head>

<FormLayout>
	<div class="space-y-8">
		<PageHeader title="Profile" description="Your name, how you sign in, and your data." />

		<div class="flex items-center gap-4">
			<div
				class="grid size-16 shrink-0 place-items-center rounded-full bg-sunk font-(family-name:--font-fig) text-2xl font-bold shadow-[inset_0_0_0_1px_var(--border)]"
				aria-hidden="true"
			>
				{initials}
			</div>
			<div class="min-w-0">
				<p class="truncate text-lg font-semibold">{user?.displayName ?? 'Unknown'}</p>
				<p class="truncate text-sm text-muted-foreground">{user?.email ?? ''}</p>
			</div>
		</div>

		{#if linkErrorMessage}
			<div class="flex items-start gap-3 rounded-(--r-md) bg-due-tint p-4" role="alert">
				<TriangleAlert class="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
				<p class="text-sm">{linkErrorMessage}</p>
			</div>
		{/if}
		{#if successMessage}
			<div class="flex items-start gap-3 rounded-(--r-md) bg-ok-tint p-4" role="status">
				<CircleCheck class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
				<p class="text-sm">{successMessage}</p>
			</div>
		{/if}

		<Card variant="section">
			<CardHeader>
				<CardTitle level={2} class="text-base">You</CardTitle>
			</CardHeader>
			<CardContent>
				<dl class="divide-y">
					<div class="flex min-h-14 items-center justify-between gap-3 py-2">
						<dt class="shrink-0 text-sm font-medium">Display name</dt>
						<dd class="flex min-w-0 items-center justify-end gap-2">
							{#if isEditingName}
								<Input
									bind:value={nameDraft}
									maxlength={100}
									class="max-w-[220px]"
									disabled={isSavingName}
									aria-label="Display name"
									onkeydown={(e: KeyboardEvent) => {
										if (e.key === 'Enter') saveDisplayName();
										if (e.key === 'Escape') cancelEditName();
									}}
								/>
								<Button
									size="icon-lg"
									variant="ghost"
									onclick={saveDisplayName}
									disabled={isSavingName}
									aria-label="Save display name"
								>
									{#if isSavingName}
										<LoaderCircle class="size-4 animate-spin" />
									{:else}
										<Check class="size-4" />
									{/if}
								</Button>
								<Button
									size="icon-lg"
									variant="ghost"
									onclick={cancelEditName}
									disabled={isSavingName}
									aria-label="Cancel editing"
								>
									<X class="size-4" />
								</Button>
							{:else}
								<span class="truncate text-sm">{user?.displayName ?? '—'}</span>
								<Button variant="outline" onclick={startEditName} aria-label="Edit display name">
									Edit
								</Button>
							{/if}
						</dd>
					</div>
					<div class="flex min-h-14 items-center justify-between gap-3 py-2">
						<dt class="text-sm font-medium">Email</dt>
						<dd class="truncate text-sm text-muted-foreground">{user?.email ?? '—'}</dd>
					</div>
					<div class="flex min-h-14 items-center justify-between gap-3 py-2">
						<dt class="text-sm font-medium">Member since</dt>
						<dd class="text-sm text-muted-foreground">{memberSince || '—'}</dd>
					</div>
				</dl>
			</CardContent>
		</Card>

		<Card variant="section">
			<CardHeader>
				<CardTitle level={2} class="text-base">Sign-in methods</CardTitle>
				<CardDescription>The accounts you can sign in to VROOM with.</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3">
				{#if unlinkError}
					<div class="flex items-start gap-3 rounded-(--r-md) bg-due-tint p-3" role="alert">
						<TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
						<p class="text-sm">{unlinkError}</p>
					</div>
				{/if}
				{#if isLoadingAccounts}
					<div class="space-y-2" aria-hidden="true">
						<Skeleton class="h-14 w-full" />
						<Skeleton class="h-14 w-full" />
					</div>
					<span class="sr-only" role="status">Loading sign-in methods</span>
				{:else}
					<ul class="divide-y">
						{#each accounts as account (account.id)}
							{@const IconComponent = authProviderIcon(account.providerType)}
							<li class="flex min-h-14 items-center justify-between gap-3 py-2">
								<div class="flex min-w-0 items-center gap-3">
									<div class="grid size-9 shrink-0 place-items-center rounded-full bg-sunk">
										<IconComponent
											class="size-5 {authProviderHasLogo(account.providerType)
												? ''
												: 'text-muted-foreground'}"
										/>
									</div>
									<div class="min-w-0">
										<p class="truncate text-sm font-medium">{account.displayName}</p>
										<p class="truncate text-sm text-muted-foreground">{account.email}</p>
									</div>
								</div>
								<Button
									variant="outline"
									aria-label="Unlink {account.displayName}"
									disabled={accounts.length <= 1 || unlinkingId !== null}
									onclick={() => confirmUnlink(account)}
								>
									{#if unlinkingId === account.id}
										<LoaderCircle class="size-4 animate-spin" />
									{/if}
									Unlink
								</Button>
							</li>
						{/each}
					</ul>

					{#if unlinkableProviders.length > 0}
						<div class="space-y-1 pt-2">
							<p class="text-sm font-medium">Link another account</p>
							<ul class="divide-y">
								{#each unlinkableProviders as provider (provider.id)}
									{@const ProviderIcon = authProviderIcon(provider.id)}
									<li class="flex min-h-14 items-center justify-between gap-3 py-2">
										<div class="flex min-w-0 items-center gap-3">
											<div class="grid size-9 shrink-0 place-items-center rounded-full bg-sunk">
												<ProviderIcon class="size-5" />
											</div>
											<p class="truncate text-sm font-medium">{provider.displayName}</p>
										</div>
										<Button
											variant="outline"
											aria-label="{linkingProvider === provider.id
												? 'Linking'
												: 'Link'} {provider.displayName}"
											disabled={linkingProvider !== null}
											onclick={() => handleLink(provider.id)}
										>
											{#if linkingProvider === provider.id}
												<LoaderCircle class="size-4 animate-spin" />
												Linking…
											{:else}
												Link
											{/if}
										</Button>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				{/if}
			</CardContent>
		</Card>

		<Card variant="section">
			<CardHeader>
				<CardTitle level={2} class="text-base">Your data</CardTitle>
			</CardHeader>
			<CardContent>
				<ul class="divide-y">
					<li class="flex min-h-14 items-center justify-between gap-3 py-2">
						<div class="min-w-0">
							<p class="text-sm font-medium">Export everything</p>
							<p class="text-sm text-muted-foreground">
								A ZIP of your data as CSV. Photos aren't included.
							</p>
						</div>
						<Button variant="outline" onclick={handleExportData} disabled={isExporting}>
							{#if isExporting}
								<LoaderCircle class="size-4 animate-spin" />
								Exporting…
							{:else}
								Export
							{/if}
						</Button>
					</li>
					<li class="flex min-h-14 items-center justify-between gap-3 py-2">
						<p class="text-sm font-medium">Delete account</p>
						<Badge variant="outline">Coming soon</Badge>
					</li>
				</ul>
			</CardContent>
		</Card>

		<ComingSoonCard
			icon={Monitor}
			title="Sessions"
			description="View and manage your active sessions"
			items={[
				{ icon: Monitor, label: 'Active sessions' },
				{ icon: Clock, label: 'Last login' },
				{ icon: LogOut, label: 'Sign out other devices' }
			]}
		/>

		<ComingSoonCard
			icon={Users}
			title="Sharing"
			description="Household access and shared vehicles"
			items={[
				{ icon: UserPlus, label: 'Invite household member' },
				{ icon: Users, label: 'Manage shared access' }
			]}
		/>

		<ComingSoonCard
			icon={Bell}
			title="Notifications"
			description="Reminders and alert preferences"
			items={[
				{ icon: Bell, label: 'Payment reminders' },
				{ icon: Bell, label: 'Maintenance reminders' },
				{ icon: Bell, label: 'Backup failure alerts' }
			]}
		/>
	</div>
</FormLayout>

<ConfirmDialog
	bind:open={unlinkConfirmOpen}
	title="Unlink sign-in method?"
	description={pendingUnlink
		? `You will no longer be able to sign in with ${pendingUnlink.displayName} (${pendingUnlink.email}). Your vehicles and expenses stay. You can link it again later.`
		: ''}
	confirmLabel="Unlink"
	onConfirm={() => (pendingUnlink ? handleUnlink(pendingUnlink.id) : undefined)}
/>
