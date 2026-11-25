<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Hourglass, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import BrandMark from '#lib/components/common/BrandMark.svelte';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	let signingOut = $state(false);

	async function checkAgain() {
		await authStore.recheckSession();
		if (authStore.user?.pendingApproval) appStore.showInfo('Still waiting for an admin.');
	}

	async function signOut() {
		signingOut = true;
		try {
			await authStore.logout();
			await goto(resolve(routes.auth));
		} catch (e) {
			appStore.showError(`Couldn't sign out. ${userFacingErrorMessage(e)}`);
		} finally {
			signingOut = false;
		}
	}
</script>

<svelte:head>
	<title>Waiting for approval - VROOM Car Tracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md space-y-6 text-center" data-testid="account-pending">
		<BrandMark class="mx-auto h-12 w-12" />
		<Card.Root>
			<Card.Content class="space-y-4 pt-6">
				<Hourglass class="mx-auto h-8 w-8 text-muted-foreground" />
				<h1 class="text-2xl font-bold tracking-tight">Waiting for approval</h1>
				<p class="text-sm text-muted-foreground">
					An admin of this server needs to approve
					<span class="font-medium text-foreground">{authStore.user?.email ?? 'your account'}</span>
					before you can use VROOM. Check back after they do.
				</p>
				<div class="flex flex-col gap-2 sm:flex-row sm:justify-center">
					<Button
						class="h-10"
						onclick={() => void checkAgain()}
						disabled={authStore.recheckingSession}
					>
						{#if authStore.recheckingSession}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
						Check Again
					</Button>
					<Button variant="outline" class="h-10" onclick={signOut} disabled={signingOut}>
						Sign Out
					</Button>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
