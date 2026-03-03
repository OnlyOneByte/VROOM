<script lang="ts">
	import { CircleUser } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import EmptyState from '$lib/components/common/empty-state.svelte';
</script>

<svelte:head>
	<title>Profile - VROOM Car Tracker</title>
	<meta name="description" content="Manage your profile and account settings" />
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Profile</h1>
		<p class="text-muted-foreground">Manage your account and personal preferences</p>
	</div>

	<EmptyState>
		{#snippet icon()}
			<CircleUser class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			Profile Coming Soon
		{/snippet}
		{#snippet description()}
			Profile management features are under development. You'll be able to update your account
			details, preferences, and notification settings.
		{/snippet}
		{#snippet action()}
			<Button href="/dashboard">Back to Dashboard</Button>
		{/snippet}
	</EmptyState>
</div>
