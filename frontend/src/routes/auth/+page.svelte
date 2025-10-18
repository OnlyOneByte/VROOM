<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { LoaderCircle } from 'lucide-svelte';

	let isLoading = false;

	// Use automatic store subscription
	let authState = $derived($authStore);

	// Redirect if already authenticated
	$effect(() => {
		if (!authState.isLoading && authState.isAuthenticated) {
			goto('/dashboard');
		}
	});

	function handleGoogleLogin() {
		isLoading = true;
		authStore.loginWithGoogle();
	}
</script>

<svelte:head>
	<title>Login - VROOM Car Tracker</title>
	<meta name="description" content="Sign in to track your vehicle expenses" />
</svelte:head>

<div
	class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4"
>
	<div class="w-full max-w-md space-y-8">
		<!-- Logo and Title -->
		<div class="text-center space-y-2">
			<div
				class="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl shadow-lg mb-4"
			>
				<span class="text-5xl">🚗</span>
			</div>
			<h1 class="text-4xl font-bold tracking-tight">VROOM</h1>
			<p class="text-muted-foreground text-lg">Track your vehicle expenses with ease</p>
		</div>

		<!-- Auth Card -->
		<Card.Root class="border-2">
			<Card.Header class="space-y-1 text-center">
				<Card.Title class="text-2xl">Welcome back</Card.Title>
				<Card.Description>Sign in to continue to your dashboard</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Button
					variant="outline"
					size="lg"
					class="w-full h-12 text-base"
					disabled={isLoading}
					onclick={handleGoogleLogin}
				>
					{#if isLoading}
						<LoaderCircle class="mr-2 h-5 w-5 animate-spin" />
						Signing in...
					{:else}
						<svg class="mr-2 h-5 w-5" viewBox="0 0 24 24">
							<path
								fill="#4285F4"
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							/>
							<path
								fill="#34A853"
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							/>
							<path
								fill="#FBBC05"
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							/>
							<path
								fill="#EA4335"
								d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							/>
						</svg>
						Continue with Google
					{/if}
				</Button>

				<p class="text-xs text-muted-foreground text-center">
					Secure OAuth authentication. We only store your email and display name.
				</p>
			</Card.Content>
		</Card.Root>

		<!-- Footer -->
		<p class="text-center text-sm text-muted-foreground">
			No account needed • Sign in with Google to get started
		</p>
	</div>
</div>
