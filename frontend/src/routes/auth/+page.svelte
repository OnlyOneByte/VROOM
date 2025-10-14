<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { LogIn } from 'lucide-svelte';

	let isLoading = false;

	// Redirect if already authenticated
	onMount(() => {
		const unsubscribe = authStore.subscribe(({ isAuthenticated, isLoading: authLoading }) => {
			if (!authLoading && isAuthenticated) {
				goto('/dashboard');
			}
		});

		return unsubscribe;
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

<div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
	<div class="max-w-md w-full space-y-8">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<h2 class="text-3xl font-bold text-gray-900 mb-2">
				Welcome to VROOM
			</h2>
			<p class="text-gray-600">
				Track your vehicle expenses and analyze costs
			</p>
		</div>

		<div class="card">
			<div class="space-y-6">
				<div>
					<h3 class="text-lg font-medium text-gray-900 mb-4">
						Sign in to your account
					</h3>
					<p class="text-sm text-gray-600 mb-6">
						We use secure OAuth authentication. No passwords required!
					</p>
				</div>

				<button
					type="button"
					class="w-full flex justify-center items-center gap-3 px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors duration-200"
					class:opacity-50={isLoading}
					disabled={isLoading}
					on:click={handleGoogleLogin}
				>
					{#if isLoading}
						<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600"></div>
					{:else}
						<LogIn class="h-5 w-5" />
					{/if}
					Continue with Google
				</button>

				<div class="text-xs text-gray-500 text-center">
					By signing in, you agree to our privacy practices. We only store your email and display name.
				</div>
			</div>
		</div>
	</div>
</div>