<script lang="ts">
	import { onMount } from 'svelte';
	import { Bell, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import * as pushUtil from '#lib/utils/push.ts';
	import { pushApi } from '#lib/services/push-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { UNEXPECTED_FAILURE_MESSAGE, userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	const DISCLOSURE_KEY = 'vroom.push.disclosed';

	let status = $state<pushUtil.PushStatus>('off');
	let isLoading = $state(true);
	let isToggling = $state(false);
	let loadError = $state<string | null>(null);
	let showDisclosure = $state(false);

	let statusLine = $derived(pushUtil.pushStatusLabel(status));
	let toggleable = $derived(status === 'off' || status === 'subscribed');
	let isOn = $derived(status === 'subscribed');

	async function loadStatus() {
		isLoading = true;
		loadError = null;
		try {
			const supported = pushUtil.isPushSupported();
			if (!supported) {
				status = 'unsupported';
				return;
			}
			const { enabled: configured } = await pushApi.getVapidPublicKey();
			const permission = pushUtil.getNotificationPermission();
			const sub = await pushUtil.getExistingSubscription();
			status = pushUtil.derivePushStatus({ supported, configured, permission, subscribed: !!sub });
		} catch (e) {
			status = 'error';
			loadError = `Couldn't check notification status. ${userFacingErrorMessage(e)}`;
		} finally {
			isLoading = false;
		}
	}

	onMount(loadStatus);

	function isDisclosed(): boolean {
		return typeof localStorage !== 'undefined' && localStorage.getItem(DISCLOSURE_KEY) === '1';
	}

	function acknowledgeDisclosure() {
		try {
			localStorage.setItem(DISCLOSURE_KEY, '1');
		} catch {
			// Storage may be unavailable (private mode); the disclosure is re-asked next time.
		}
		showDisclosure = false;
		void doEnable();
	}

	function onToggle(checked: boolean) {
		if (isToggling) return;
		if (checked) {
			if (!isDisclosed()) {
				showDisclosure = true;
				return;
			}
			void doEnable();
		} else {
			void doDisable();
		}
	}

	async function doEnable() {
		isToggling = true;
		try {
			const outcome = await pushUtil.enablePush();
			if (outcome.ok) {
				status = 'subscribed';
				appStore.showSuccess('Push notifications turned on');
				return;
			}
			if (outcome.reason === 'denied') {
				status = 'denied';
			} else if (outcome.reason === 'unsupported') {
				status = 'unsupported';
			} else if (outcome.reason === 'unconfigured') {
				status = 'unconfigured';
				appStore.showError("Push notifications aren't set up on this server.");
			} else {
				appStore.showError(
					`Couldn't turn on push notifications. ${outcome.message ?? UNEXPECTED_FAILURE_MESSAGE}`
				);
			}
		} finally {
			isToggling = false;
		}
	}

	async function doDisable() {
		isToggling = true;
		try {
			await pushUtil.disablePush();
			status = 'off';
			appStore.showSuccess('Push notifications turned off');
		} catch (e) {
			appStore.showError(`Couldn't turn off push notifications. ${userFacingErrorMessage(e)}`);
		} finally {
			isToggling = false;
		}
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<Bell class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Push Notifications</CardTitle>
		</div>
		<CardDescription>
			Get a browser notification when a reminder comes due — even when VROOM isn't open. Delivery is
			best-effort: a notification fires when VROOM next runs a reminder check, not on a fixed
			schedule.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<div class="flex items-center justify-center py-6" data-testid="push-loading">
				<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if status === 'error'}
			<div class="space-y-3" data-testid="push-error">
				<p class="text-sm text-destructive">{loadError}</p>
				<Button variant="outline" size="sm" onclick={loadStatus}>Retry</Button>
			</div>
		{:else}
			<div class="flex items-center justify-between gap-4" data-testid="push-card">
				<div class="min-w-0 space-y-0.5">
					<p class="text-sm font-medium">Reminder alerts</p>
					<p class="text-xs text-muted-foreground" data-testid="push-status">{statusLine}</p>
				</div>
				{#if toggleable}
					<div class="flex items-center gap-2 shrink-0">
						{#if isToggling}
							<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
						{/if}
						<Switch
							checked={isOn}
							onCheckedChange={onToggle}
							disabled={isToggling}
							aria-label="Toggle push notifications"
							data-testid="push-toggle"
						/>
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>

<AlertDialog.Root bind:open={showDisclosure}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Turn on push notifications?</AlertDialog.Title>
			<AlertDialog.Description>
				Your browser will ask permission to show notifications. Once allowed, VROOM sends a
				notification to this device when a reminder comes due. Delivery is request-driven — the
				notification fires when VROOM next runs a reminder check, not at a guaranteed time. Your
				subscription stays private to your account, and you can turn this off any time.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (showDisclosure = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={acknowledgeDisclosure}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
