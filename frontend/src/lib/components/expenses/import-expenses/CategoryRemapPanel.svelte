<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { CircleAlert } from '@lucide/svelte';
	import type { ExpenseCategory } from '$lib/types';
	import { categoryLabels } from '$lib/utils/expense-helpers';

	interface Props {
		unmappedCategories: string[];
		categoryRemap: Record<string, ExpenseCategory>;
		onRemap: (_word: string, _category: ExpenseCategory) => void;
	}

	let { unmappedCategories, categoryRemap, onRemap }: Props = $props();

	const CATEGORY_OPTIONS = Object.entries(categoryLabels) as [ExpenseCategory, string][];
</script>

{#if unmappedCategories.length > 0}
	<div class="space-y-3 rounded-lg border border-chart-4/40 bg-chart-4/5 p-4">
		<div class="flex items-center gap-2 text-sm font-medium text-foreground">
			<CircleAlert class="h-4 w-4 text-chart-4" />
			Unrecognized categories
		</div>
		<p class="text-xs text-muted-foreground">
			These category names from your file aren't VROOM categories — they'll import as
			<span class="text-foreground">Misc</span> unless you map them.
		</p>
		<div class="space-y-2">
			{#each unmappedCategories as word (word)}
				<div class="flex items-center gap-2">
					<span class="w-28 shrink-0 truncate text-xs text-foreground" title={word}>{word}</span>
					<Select.Root
						type="single"
						value={categoryRemap[word] ?? ''}
						onValueChange={v => onRemap(word, v as ExpenseCategory)}
					>
						<Select.Trigger class="h-8 flex-1 text-xs" data-testid="remap-category-{word}">
							{categoryRemap[word] ? categoryLabels[categoryRemap[word]] : 'Map to… (Misc)'}
						</Select.Trigger>
						<Select.Content>
							{#each CATEGORY_OPTIONS as [value, label] (value)}
								<Select.Item {value} {label}>{label}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/each}
		</div>
	</div>
{/if}
