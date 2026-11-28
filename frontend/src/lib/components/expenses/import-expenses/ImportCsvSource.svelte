<script lang="ts">
	import { Upload } from '@lucide/svelte';

	interface Props {
		csvText: string;
		fileName: string | null;
		accept?: string[] | undefined;
		onFileChange: (_file: File) => void;
		onPasteBlur: () => void;
	}

	let { csvText = $bindable(), fileName, accept, onFileChange, onPasteBlur }: Props = $props();

	let extensions = $derived(accept?.filter(type => type.startsWith('.')) ?? []);
	let chooseLabel = $derived(
		extensions.length
			? `Choose a ${new Intl.ListFormat('en', { type: 'disjunction' }).format(extensions)} file`
			: 'Choose a file'
	);

	function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = '';
		onFileChange(file);
	}
</script>

<div class="space-y-2">
	<label
		for="import-csv-file"
		class="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
	>
		<Upload class="h-5 w-5" />
		<span>{fileName ?? chooseLabel}</span>
	</label>
	<input
		id="import-csv-file"
		type="file"
		accept={accept?.join(',')}
		class="sr-only"
		onchange={handleFileChange}
	/>
</div>

<div class="space-y-2">
	<label for="import-csv-text" class="text-sm font-medium">Or paste CSV</label>
	<textarea
		id="import-csv-text"
		bind:value={csvText}
		onblur={onPasteBlur}
		rows="4"
		placeholder="date,vehicle,category,amount,..."
		class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
	></textarea>
</div>
