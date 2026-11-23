<script lang="ts">
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import type { ProviderFormProps } from '#lib/constants/providers.ts';

	let { existingConfig, isEditMode, connection = $bindable() }: ProviderFormProps = $props();

	const stored = (key: string) => (existingConfig?.[key] as string | undefined) ?? '';
	let endpoint = $state(stored('endpoint'));
	let bucket = $state(stored('bucket'));
	let region = $state(stored('region'));
	let accessKeyId = $state('');
	let secretAccessKey = $state('');

	$effect(() => {
		const hasKeys = !!(accessKeyId && secretAccessKey);
		connection = {
			ready: !!(endpoint && bucket && (isEditMode || hasKeys)),
			config: { endpoint, bucket, region },
			credentials: hasKeys ? { accessKeyId, secretAccessKey } : {}
		};
	});
</script>

<div class="space-y-4">
	<div class="space-y-2">
		<Label for="s3-endpoint">Endpoint</Label>
		<Input id="s3-endpoint" bind:value={endpoint} placeholder="s3.us-west-002.backblazeb2.com" />
	</div>

	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="s3-bucket">Bucket</Label>
			<Input id="s3-bucket" bind:value={bucket} placeholder="vroom-photos" />
		</div>
		<div class="space-y-2">
			<Label for="s3-region">Region</Label>
			<Input id="s3-region" bind:value={region} placeholder="us-west-002" />
		</div>
	</div>

	<div class="space-y-2">
		<Label for="s3-access-key">Access Key ID</Label>
		<Input
			id="s3-access-key"
			type="password"
			bind:value={accessKeyId}
			placeholder="Enter access key ID"
		/>
	</div>

	<div class="space-y-2">
		<Label for="s3-secret-key">Secret Access Key</Label>
		<Input
			id="s3-secret-key"
			type="password"
			bind:value={secretAccessKey}
			placeholder="Enter secret access key"
		/>
	</div>
</div>

{#if isEditMode}
	<p class="text-xs text-muted-foreground mt-3">Leave credentials blank to keep existing values.</p>
{/if}
