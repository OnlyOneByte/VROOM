<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let {
		config,
		credentials,
		onConfigChange,
		onCredentialsChange
	}: {
		config: { endpoint: string; bucket: string; region: string; photoRootPath: string };
		credentials: { accessKeyId: string; secretAccessKey: string };
		onConfigChange: (_config: {
			endpoint: string;
			bucket: string;
			region: string;
			photoRootPath: string;
		}) => void;
		onCredentialsChange: (_creds: { accessKeyId: string; secretAccessKey: string }) => void;
	} = $props();

	function updateConfig(field: string, value: string) {
		onConfigChange({ ...config, [field]: value });
	}

	function updateCredentials(field: string, value: string) {
		onCredentialsChange({ ...credentials, [field]: value });
	}
</script>

<div class="space-y-4">
	<div class="space-y-2">
		<Label for="s3-endpoint">Endpoint</Label>
		<Input
			id="s3-endpoint"
			value={config.endpoint}
			oninput={e => updateConfig('endpoint', e.currentTarget.value)}
			placeholder="s3.us-west-002.backblazeb2.com"
		/>
	</div>

	<div class="grid grid-cols-2 gap-3">
		<div class="space-y-2">
			<Label for="s3-bucket">Bucket</Label>
			<Input
				id="s3-bucket"
				value={config.bucket}
				oninput={e => updateConfig('bucket', e.currentTarget.value)}
				placeholder="vroom-photos"
			/>
		</div>
		<div class="space-y-2">
			<Label for="s3-region">Region</Label>
			<Input
				id="s3-region"
				value={config.region}
				oninput={e => updateConfig('region', e.currentTarget.value)}
				placeholder="us-west-002"
			/>
		</div>
	</div>

	<div class="space-y-2">
		<Label for="s3-access-key">Access Key ID</Label>
		<Input
			id="s3-access-key"
			type="password"
			value={credentials.accessKeyId}
			oninput={e => updateCredentials('accessKeyId', e.currentTarget.value)}
			placeholder="Enter access key ID"
		/>
	</div>

	<div class="space-y-2">
		<Label for="s3-secret-key">Secret Access Key</Label>
		<Input
			id="s3-secret-key"
			type="password"
			value={credentials.secretAccessKey}
			oninput={e => updateCredentials('secretAccessKey', e.currentTarget.value)}
			placeholder="Enter secret access key"
		/>
	</div>
</div>
