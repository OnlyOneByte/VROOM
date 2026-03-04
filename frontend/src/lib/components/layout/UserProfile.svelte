<script lang="ts">
	import { authStore } from '$lib/stores/auth.svelte';
	import { LogOut, Settings } from 'lucide-svelte';
	import { Avatar, AvatarFallback, AvatarImage } from '$lib/components/ui/avatar';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuSeparator,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';

	let { user, compact = false } = $props();

	// Generate user initials from display name
	let initials = $derived(
		user?.displayName
			?.split(' ')
			.map((n: string) => n[0])
			.join('')
			.toUpperCase() || 'U'
	);

	function handleLogout() {
		authStore.logout();
	}
</script>

<DropdownMenu>
	<DropdownMenuTrigger>
		{#if compact}
			<!-- Compact version for mobile/small spaces -->
			<button
				type="button"
				class="hover:opacity-80 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-ring rounded-full"
			>
				<Avatar class="size-8">
					{#if user?.photoURL}
						<AvatarImage src={user.photoURL} alt={user?.displayName || 'User'} />
					{/if}
					<AvatarFallback class="bg-primary/10 text-primary text-xs font-medium">
						{initials}
					</AvatarFallback>
				</Avatar>
			</button>
		{:else}
			<!-- Full version with name and email -->
			<button
				type="button"
				class="flex items-center w-full px-3 py-2 text-left hover:bg-muted rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring"
			>
				<Avatar class="size-8 mr-3 flex-shrink-0">
					{#if user?.photoURL}
						<AvatarImage src={user.photoURL} alt={user?.displayName || 'User'} />
					{/if}
					<AvatarFallback class="bg-primary/10 text-primary text-xs font-medium">
						{initials}
					</AvatarFallback>
				</Avatar>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium text-foreground truncate">
						{user?.displayName || 'User'}
					</p>
					<p class="text-xs text-muted-foreground truncate">
						{user?.email || ''}
					</p>
				</div>
			</button>
		{/if}
	</DropdownMenuTrigger>

	<DropdownMenuContent align="end" class="w-48">
		{#if compact}
			<!-- Show user info in dropdown for compact version -->
			<DropdownMenuLabel>
				<div class="flex flex-col">
					<span class="text-sm font-medium text-foreground truncate">
						{user?.displayName || 'User'}
					</span>
					<span class="text-xs text-muted-foreground truncate">
						{user?.email || ''}
					</span>
				</div>
			</DropdownMenuLabel>
			<DropdownMenuSeparator />
		{/if}

		<a href="/settings">
			<DropdownMenuItem>
				<Settings class="mr-3 h-4 w-4" />
				Settings
			</DropdownMenuItem>
		</a>

		<DropdownMenuItem onclick={handleLogout}>
			<LogOut class="mr-3 h-4 w-4" />
			Sign out
		</DropdownMenuItem>
	</DropdownMenuContent>
</DropdownMenu>
