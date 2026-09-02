<script lang="ts">
	/**
	 * Push notifications settings card — push-notifications T5 (honors D5 opt-in + D6 timing honesty).
	 *
	 * Opt-in surface for browser Web Push: a toggle + a status line that names the exact state
	 * (unsupported / not-configured-503 / blocked / on / off). Enabling is gated behind a first-use
	 * AlertDialog disclosure (D5, remembered in localStorage) that states what push does and — honestly —
	 * that delivery is request-driven (a notification fires when VROOM next runs a reminder check, not on
	 * a guaranteed schedule; D6). No auto-fired permission prompt: the browser prompt only appears after
	 * the user turns the toggle on and acknowledges the disclosure.
	 *
	 * All browser Push API + transport logic lives in `$lib/utils/push`; this card is a thin view over
	 * the pure `derivePushStatus` state machine.
	 */
	import { onMount } from 'svelte';
	import { Bell, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import * as pushUtil from '$lib/utils/push';
	import { pushApi } from '$lib/services/push-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { ApiError } from '$lib/utils/error-handling';

	const DISCLOSURE_KEY = 'vroom.push.disclosed';

	let status = $state<pushUtil.PushStatus>('off');
	let isLoading = $state(true);
	let isToggling = $state(false);
	let loadError = $state<string | null>(null);
	let showDisclosure = $state(false);

	let statusLine = $derived(pushUtil.pushStatusLabel(status));
	// The toggle is only meaningful when the browser can actually enable/disable — the other states are
	// terminal messages (nothing to toggle), so we hide the switch and just explain.
	let toggleable = $derived(status === 'off' || status === 'subscribed');
	let isOn = $derived(status === 'subscribed');

	/** Determine the current push state on this browser (supported? configured? blocked? subscribed?). */
	async function loadStatus() {
		isLoading = true;
		loadError = null;
		try {
			const supported = pushUtil.isPushSupported();
			if (!supported) {
				status = 'unsupported';
				return;
			}
			// Is push configured on the server? A 503 PUSH_NOT_CONFIGURED means the feature is off.
			let configured = true;
			try {
				await pushApi.getVapidPublicKey();
			} catch (e) {
				if (e instanceof ApiError && (e.code === 'PUSH_NOT_CONFIGURED' || e.statusCode === 503)) {
					configured = false;
				} else {
					throw e;
				}
			}
			const permission = pushUtil.getNotificationPermission();
			const sub = await pushUtil.getExistingSubscription();
			status = pushUtil.derivePushStatus({ supported, configured, permission, subscribed: !!sub });
		} catch (e) {
			status = 'error';
			loadError = e instanceof Error ? e.message : 'Failed to check notification status';
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
			// localStorage may be unavailable (private mode) — proceed anyway; we just re-ask next time.
		}
		showDisclosure = false;
		void doEnable();
	}

	/** The Switch intent handler: turning on gates behind the disclosure; turning off is immediate. */
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
			// Map the exact reason to a status line and/or a toast.
			if (outcome.reason === 'denied') {
				status = 'denied';
			} else if (outcome.reason === 'unsupported') {
				status = 'unsupported';
			} else if (outcome.reason === 'unconfigured') {
				status = 'unconfigured';
				appStore.showError('Push notifications are not configured on this server');
			} else {
				appStore.showError(outcome.message ?? 'Could not enable push notifications');
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
		} catch {
			appStore.showError('Could not turn off push notifications');
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
