<script lang="ts">
	import { TriangleAlert, RefreshCw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';

	interface Props {
		/** Error object if an error occurred */
		error?: Error | null;
		/** Whether to show the error UI */
		hasError?: boolean;
		/** Callback to reset the error state */
		onReset?: () => void;
		/** Children to render when no error */
		children?: import('svelte').Snippet;
	}

	let { error = null, hasError = false, onReset, children }: Props = $props();

	function handleReset() {
		if (onReset) {
			onReset();
		} else {
			// Default behavior: reload the page
			window.location.reload();
		}
	}
</script>

{#if hasError && error}
	<div class="min-h-[400px] flex items-center justify-center p-4">
		<Card class="max-w-lg w-full">
			<CardHeader>
				<CardTitle class="flex items-center gap-2 text-destructive">
					<TriangleAlert class="h-6 w-6" />
					Something went wrong
				</CardTitle>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="text-sm text-muted-foreground">
					<p class="mb-2">An unexpected error occurred:</p>
					<div class="bg-muted p-3 rounded-md font-mono text-xs overflow-auto">
						{error.message}
					</div>
				</div>

				{#if error.stack && import.meta.env.DEV}
					<details class="text-xs">
						<summary class="cursor-pointer text-muted-foreground hover:text-foreground">
							Stack trace (dev only)
						</summary>
						<pre class="mt-2 bg-muted p-3 rounded-md overflow-auto text-[10px]">{error.stack}</pre>
					</details>
				{/if}

				<div class="flex gap-2">
					<Button onclick={handleReset} class="flex-1">
						<RefreshCw class="h-4 w-4 mr-2" />
						Try Again
					</Button>
					<Button variant="outline" onclick={() => (window.location.href = '/dashboard')}>
						Go to Dashboard
					</Button>
				</div>
			</CardContent>
		</Card>
	</div>
{:else}
	{@render children?.()}
{/if}
