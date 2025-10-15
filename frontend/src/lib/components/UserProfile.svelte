<script lang="ts">
	import { authStore } from '$lib/stores/auth.js';
	import { User, LogOut, Settings } from 'lucide-svelte';

	let { user, compact = false } = $props();

	let showDropdown = $state(false);

	function toggleDropdown() {
		showDropdown = !showDropdown;
	}

	function closeDropdown() {
		showDropdown = false;
	}

	function handleLogout() {
		authStore.logout();
		closeDropdown();
	}

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (!target.closest('.user-profile-dropdown')) {
			closeDropdown();
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

<div class="relative user-profile-dropdown">
	{#if compact}
		<!-- Compact version for mobile/small spaces -->
		<button
			type="button"
			class="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full hover:bg-primary-200 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
			onclick={toggleDropdown}
		>
			<User class="h-4 w-4 text-primary-600" />
		</button>
	{:else}
		<!-- Full version with name and email -->
		<button
			type="button"
			class="flex items-center w-full px-3 py-2 text-left hover:bg-gray-100 rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
			onclick={toggleDropdown}
		>
			<div
				class="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full mr-3 flex-shrink-0"
			>
				<User class="h-4 w-4 text-primary-600" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-medium text-gray-900 truncate">
					{user?.displayName || 'User'}
				</p>
				<p class="text-xs text-gray-500 truncate">
					{user?.email || ''}
				</p>
			</div>
		</button>
	{/if}

	{#if showDropdown}
		<div
			class="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50"
		>
			<div class="py-1">
				{#if compact}
					<!-- Show user info in dropdown for compact version -->
					<div class="px-4 py-2 border-b border-gray-100">
						<p class="text-sm font-medium text-gray-900 truncate">
							{user?.displayName || 'User'}
						</p>
						<p class="text-xs text-gray-500 truncate">
							{user?.email || ''}
						</p>
					</div>
				{/if}

				<a
					href="/settings"
					class="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors duration-200"
					onclick={closeDropdown}
				>
					<Settings class="mr-3 h-4 w-4 text-gray-500" />
					Settings
				</a>

				<button
					type="button"
					class="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors duration-200"
					onclick={handleLogout}
				>
					<LogOut class="mr-3 h-4 w-4 text-gray-500" />
					Sign out
				</button>
			</div>
		</div>
	{/if}
</div>
