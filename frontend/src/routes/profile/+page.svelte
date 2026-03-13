<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/auth.svelte';
	import { authApi } from '$lib/services/auth-api';
	import { getApiBaseUrl } from '$lib/services/api-client';
	import type { LinkedAuthProvider } from '$lib/types';
	import type { Component } from 'svelte';
	import {
		CircleUser,
		Link2,
		Monitor,
		Shield,
		Users,
		Bell,
		Mail,
		Calendar,
		LogOut,
		Download,
		Trash2,
		UserPlus,
		Clock,
		LoaderCircle,
		Unlink,
		CircleAlert,
		CircleCheck,
		LogIn
	} from '@lucide/svelte';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import GoogleLogo from '$lib/components/icons/GoogleLogo.svelte';
	import GitHubLogo from '$lib/components/icons/GitHubLogo.svelte';

	const iconMap: Record<string, Component<{ class?: string }>> = {
		google: GoogleLogo,
		github: GitHubLogo
	};

	const linkErrorMessages: Record<string, string> = {
		account_conflict: 'This account is already linked to a different user.',
		already_linked: 'This account is already linked to your profile.',
		cancelled: 'Linking was cancelled.'
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
	let linkingProvider = $state<string | null>(null);

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
		return new Date(user.createdAt).toLocaleDateString('en-US', {
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
			// Silently handle — accounts will show empty
		} finally {
			isLoadingAccounts = false;
		}
	});

	async function handleUnlink(id: string) {
		unlinkingId = id;
		unlinkError = null;
		try {
			await authApi.unlinkAccount(id);
			accounts = accounts.filter(a => a.id !== id);
		} catch (err) {
			const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : '';
			if (code === 'LAST_ACCOUNT') {
				unlinkError = 'Cannot unlink your last sign-in method.';
			} else {
				unlinkError = 'Failed to unlink account. Please try again.';
			}
		} finally {
			unlinkingId = null;
		}
	}

	function handleLink(providerId: string) {
		if (browser) {
			linkingProvider = providerId;
			window.location.href = `${getApiBaseUrl()}/api/v1/auth/link/${providerId}`;
		}
	}
</script>

<svelte:head>
	<title>Profile - VROOM</title>
	<meta name="description" content="Manage your profile and account" />
</svelte:head>

<FormLayout>
	<div class="space-y-6">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Profile</h1>
			<p class="text-muted-foreground">Manage your account and personal preferences</p>
		</div>

		<!-- Identity -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<CircleUser class="h-5 w-5 text-muted-foreground" />
						<CardTitle>Identity</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Your account details and personal information</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex items-center gap-4 mb-6">
					<Avatar class="h-16 w-16">
						<AvatarFallback class="text-lg">{initials}</AvatarFallback>
					</Avatar>
					<div>
						<p class="text-lg font-semibold">{user?.displayName ?? 'Unknown'}</p>
						<p class="text-sm text-muted-foreground">{user?.email ?? ''}</p>
					</div>
				</div>
				<Separator class="mb-4" />
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<CircleUser class="h-4 w-4" />
							<span>Display Name</span>
						</div>
						<span class="text-sm text-muted-foreground">Edit coming soon</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Mail class="h-4 w-4" />
							<span>Email</span>
						</div>
						<span class="text-sm text-muted-foreground">Linked to OAuth</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Calendar class="h-4 w-4" />
							<span>Member Since</span>
						</div>
						<span class="text-sm">{memberSince || '—'}</span>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Link Error / Success Messages -->
		{#if linkErrorMessage}
			<div
				class="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
			>
				<CircleAlert class="h-5 w-5 text-destructive shrink-0 mt-0.5" />
				<p class="text-sm text-destructive">{linkErrorMessage}</p>
			</div>
		{/if}
		{#if successMessage}
			<div class="flex items-start gap-3 rounded-lg border border-chart-2/50 bg-chart-2/10 p-4">
				<CircleCheck class="h-5 w-5 text-chart-2 shrink-0 mt-0.5" />
				<p class="text-sm text-chart-2">{successMessage}</p>
			</div>
		{/if}

		<!-- Connected Accounts -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Link2 class="h-5 w-5 text-muted-foreground" />
					<CardTitle>Connected Accounts</CardTitle>
				</div>
				<CardDescription>Manage your linked sign-in methods</CardDescription>
			</CardHeader>
			<CardContent>
				{#if unlinkError}
					<div
						class="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 mb-3"
					>
						<CircleAlert class="h-4 w-4 text-destructive shrink-0 mt-0.5" />
						<p class="text-sm text-destructive">{unlinkError}</p>
					</div>
				{/if}
				{#if isLoadingAccounts}
					<div class="flex items-center justify-center py-6">
						<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				{:else}
					<div class="space-y-3">
						{#each accounts as account (account.id)}
							{@const IconComponent = iconMap[account.providerType]}
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
										{#if IconComponent}
											<IconComponent class="h-5 w-5" />
										{:else}
											<LogIn class="h-5 w-5 text-muted-foreground" />
										{/if}
									</div>
									<div>
										<p class="text-sm font-medium">{account.displayName}</p>
										<p class="text-xs text-muted-foreground">{account.email}</p>
									</div>
								</div>
								<Button
									variant="ghost"
									size="sm"
									disabled={accounts.length <= 1 || unlinkingId !== null}
									onclick={() => handleUnlink(account.id)}
								>
									{#if unlinkingId === account.id}
										<LoaderCircle class="h-4 w-4 animate-spin" />
									{:else}
										<Unlink class="h-4 w-4" />
									{/if}
								</Button>
							</div>
						{/each}

						{#if unlinkableProviders.length > 0}
							<Separator />
							<div class="space-y-2">
								<p class="text-sm text-muted-foreground">Link another account</p>
								{#each unlinkableProviders as provider (provider.id)}
									{@const ProviderIcon = iconMap[provider.id]}
									<Button
										variant="outline"
										size="sm"
										class="w-full justify-start"
										disabled={linkingProvider !== null}
										onclick={() => handleLink(provider.id)}
									>
										{#if linkingProvider === provider.id}
											<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
											Linking...
										{:else}
											{#if ProviderIcon}
												<ProviderIcon class="mr-2 h-4 w-4" />
											{:else}
												<LogIn class="mr-2 h-4 w-4" />
											{/if}
											Link {provider.displayName}
										{/if}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>

		<!-- Sessions -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Monitor class="h-5 w-5 text-muted-foreground" />
						<CardTitle>Sessions</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>View and manage your active sessions</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Monitor class="h-4 w-4" />
							<span>Active sessions</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Clock class="h-4 w-4" />
							<span>Last login</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<LogOut class="h-4 w-4" />
							<span>Sign out other devices</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Data & Privacy -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Shield class="h-5 w-5 text-muted-foreground" />
						<CardTitle>Data & Privacy</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Control your data and privacy preferences</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Download class="h-4 w-4" />
							<span>Export all data</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Trash2 class="h-4 w-4" />
							<span>Delete account</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Shield class="h-4 w-4" />
							<span>Data retention preferences</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Sharing -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Users class="h-5 w-5 text-muted-foreground" />
						<CardTitle>Sharing</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Household access and shared vehicles</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<UserPlus class="h-4 w-4" />
							<span>Invite household member</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Users class="h-4 w-4" />
							<span>Manage shared access</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- Notifications -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Bell class="h-5 w-5 text-muted-foreground" />
						<CardTitle>Notifications</CardTitle>
					</div>
					<Badge variant="secondary">Coming Soon</Badge>
				</div>
				<CardDescription>Reminders and alert preferences</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-3 opacity-50">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" />
							<span>Payment reminders</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" />
							<span>Maintenance reminders</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Bell class="h-4 w-4" />
							<span>Backup failure alerts</span>
						</div>
						<span class="text-sm text-muted-foreground">—</span>
					</div>
				</div>
			</CardContent>
		</Card>
	</div>
</FormLayout>
