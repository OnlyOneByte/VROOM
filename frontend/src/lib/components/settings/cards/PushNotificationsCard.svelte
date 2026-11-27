<script lang="ts">
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import { onMount, tick } from 'svelte';
	import { LoaderCircle } from '@lucide/svelte';
	import HowItWorks from '#lib/components/common/how-it-works.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import * as pushUtil from '#lib/utils/push.ts';
	import { pushApi } from '#lib/services/push-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { UNEXPECTED_FAILURE_MESSAGE, userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	const DISCLOSURE_KEY = 'vroom.push.disclosed';
	const uid = $props.id();

	let status = $state<pushUtil.PushStatus>('off');
	let isLoading = $state(true);
	let isToggling = $state(false);
	let loadError = $state<string | null>(null);
	let showDisclosure = $state(false);
	let content = $state<HTMLElement | null>(null);

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

	async function retryStatus() {
		await loadStatus();
		await tick();
		focusFirstButton(content);
	}

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

<div class="py-3 outline-none" bind:this={content} tabindex={-1}>
	{#if isLoading}
		<div class="flex items-center justify-between gap-4" data-testid="push-loading">
			<p class="font-medium">Reminder notifications</p>
			<LoaderCircle class="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
		</div>
	{:else if status === 'error'}
		<div class="space-y-2" data-testid="push-error">
			<p class="font-medium">Reminder notifications</p>
			<p class="text-sm text-destructive" role="alert">{loadError}</p>
			<Button variant="outline" onclick={retryStatus}>Retry</Button>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-4" data-testid="push-card">
			<div class="min-w-0">
				<p id="{uid}-label" class="font-medium">Reminder notifications</p>
				<p class="text-sm text-muted-foreground" data-testid="push-status">{statusLine}</p>
			</div>
			{#if toggleable}
				<div class="flex shrink-0 items-center gap-2">
					{#if isToggling}
						<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
					{/if}
					<Switch
						checked={isOn}
						onCheckedChange={onToggle}
						disabled={isToggling}
						aria-labelledby="{uid}-label"
						data-testid="push-toggle"
					/>
				</div>
			{/if}
		</div>
	{/if}
	<HowItWorks class="mt-1">
		<p class="text-sm text-muted-foreground">
			A notification arrives when a reminder comes due, even when VROOM isn't open. Delivery is
			best-effort: it fires when VROOM next runs a reminder check, not on a fixed schedule.
		</p>
	</HowItWorks>
</div>

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
