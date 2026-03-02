<script lang="ts">
	import { Sun, Moon, Monitor } from 'lucide-svelte';
	import { Label } from '$lib/components/ui/label';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { themeStore, type ThemePreference } from '$lib/stores/theme';
	import { cn } from '$lib/utils';

	let currentTheme = $derived($themeStore);

	const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor }
	];
</script>

<Card>
	<CardHeader>
		<CardTitle>Appearance</CardTitle>
		<CardDescription>Choose how VROOM looks to you</CardDescription>
	</CardHeader>
	<CardContent>
		<Label class="mb-3 block">Theme</Label>
		<div class="grid grid-cols-3 gap-3">
			{#each options as option (option.value)}
				{@const Icon = option.icon}
				<button
					type="button"
					class={cn(
						'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
						currentTheme === option.value
							? 'border-primary bg-primary/10 text-primary'
							: 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
					)}
					onclick={() => themeStore.setPreference(option.value)}
				>
					<Icon class="h-5 w-5" />
					<span class="text-sm font-medium">{option.label}</span>
				</button>
			{/each}
		</div>
	</CardContent>
</Card>
