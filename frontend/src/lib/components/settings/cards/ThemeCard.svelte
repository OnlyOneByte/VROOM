<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.ts';
	import Segmented from '#lib/components/common/Segmented.svelte';
	import { themeStore, type ThemePreference } from '#lib/stores/theme.svelte.ts';

	const options: { value: ThemePreference; label: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'Auto' }
	];
</script>

<Card variant="section">
	<CardHeader>
		<CardTitle level={2} class="text-base">Appearance</CardTitle>
	</CardHeader>
	<CardContent>
		<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1">
			<div class="min-w-0">
				<p class="font-medium">Light or dark</p>
				<p class="text-sm text-muted-foreground">
					Auto follows your device. Changes apply right away.
				</p>
			</div>
			<Segmented
				label="Light or dark"
				value={themeStore.current}
				{options}
				onValueChange={v => themeStore.setPreference(v)}
			/>
		</div>
	</CardContent>
</Card>
