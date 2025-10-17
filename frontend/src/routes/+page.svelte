<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth.js';
	import { onMount } from 'svelte';

	// Use automatic store subscription
	let authState = $derived($authStore);
	let showContent = $state(false);

	// Show content briefly before redirecting
	onMount(() => {
		showContent = true;
	});

	// Redirect based on auth state after showing content
	$effect(() => {
		if (!authState.isLoading && showContent) {
			const timer = setTimeout(() => {
				if (authState.isAuthenticated) {
					goto('/vehicles');
				} else {
					goto('/auth');
				}
			}, 2000);

			return () => clearTimeout(timer);
		}
		return undefined;
	});
</script>

<svelte:head>
	<title>VROOM Car Tracker - Your Data, Your Control</title>
	<meta
		name="description"
		content="Open source vehicle expense tracking with Google Drive sync. Your data, your control."
	/>
</svelte:head>

<div
	class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 p-4"
>
	<div class="max-w-2xl w-full text-center">
		<div class="text-7xl mb-6">🚗</div>
		<h1 class="text-4xl font-bold text-gray-900 mb-4">VROOM Car Tracker</h1>
		<p class="text-xl text-gray-700 mb-8">Vehicle Record & Organization Of Maintenance</p>

		<div class="bg-white rounded-lg shadow-lg p-8 mb-8">
			<div class="grid gap-6 text-left">
				<div class="flex items-start gap-4">
					<div class="text-3xl">🔓</div>
					<div>
						<h3 class="font-semibold text-lg text-gray-900 mb-1">Fully Open Source</h3>
						<p class="text-gray-600">
							Make it your own! Fork, customize, and host it yourself with complete control.
						</p>
					</div>
				</div>

				<div class="flex items-start gap-4">
					<div class="text-3xl">📊</div>
					<div>
						<h3 class="font-semibold text-lg text-gray-900 mb-1">Open Format CSVs</h3>
						<p class="text-gray-600">
							All data in standard CSV format. Migrate anywhere, anytime, with zero lock-in.
						</p>
					</div>
				</div>

				<div class="flex items-start gap-4">
					<div class="text-3xl">☁️</div>
					<div>
						<h3 class="font-semibold text-lg text-gray-900 mb-1">Direct Google Drive Sync</h3>
						<p class="text-gray-600">
							Your data syncs directly to your Drive. No proprietary databases to manage.
						</p>
					</div>
				</div>

				<div class="flex items-start gap-4">
					<div class="text-3xl">🔒</div>
					<div>
						<h3 class="font-semibold text-lg text-gray-900 mb-1">Privacy First</h3>
						<p class="text-gray-600">
							No data stored beyond sync. Everything lives in your Google Drive, under your control.
						</p>
					</div>
				</div>
			</div>
		</div>

		<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
		<p class="text-gray-600">Loading your dashboard...</p>
	</div>
</div>
