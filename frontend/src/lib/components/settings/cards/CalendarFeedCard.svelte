<script lang="ts">
	import { onMount } from 'svelte';
	import { Copy, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Switch } from '#lib/components/ui/switch/index.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import {
		calendarApi,
		type CalendarFeedInfo,
		type CalendarFeedOptions
	} from '#lib/services/calendar-api.ts';
	import { absoluteApiUrl } from '#lib/services/api-client.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatDate } from '#lib/utils/formatters.ts';

	type FeedSwitch = Exclude<keyof CalendarFeedOptions, 'timeZone'>;

	const SWITCHES: { key: FeedSwitch; label: string }[] = [
		{ key: 'reminders', label: 'Reminders' },
		{ key: 'insurance', label: 'Insurance renewals' },
		{ key: 'loans', label: 'Loan and lease payments' },
		{ key: 'vehicleNames', label: 'Show vehicle names' },
		{ key: 'amounts', label: 'Show amounts' }
	];

	let feed = $state<CalendarFeedInfo | null>(null);
	let options = $state<CalendarFeedOptions>({
		reminders: true,
		insurance: true,
		loans: true,
		vehicleNames: false,
		amounts: false
	});
	let link = $state<string | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let busy = $state(false);
	let confirmOff = $state(false);
	let confirmRotate = $state(false);

	let webcal = $derived(link?.replace(/^https?:/, 'webcal:') ?? null);
	const onApple =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	function withTimeZone<T>(send: (_zone: { timeZone?: string }) => Promise<T>): Promise<T> {
		return send({ timeZone }).catch(e =>
			e instanceof ApiError && e.statusCode === 400 ? send({}) : Promise.reject(e)
		);
	}

	onMount(async () => {
		try {
			feed = await calendarApi.getFeed();
			if (feed) options = { ...feed.options };
		} catch (e) {
			loadError = `Couldn't load your calendar link. ${userFacingErrorMessage(e)}`;
		} finally {
			loading = false;
		}
	});

	async function createLink() {
		busy = true;
		try {
			const created = await withTimeZone(zone => calendarApi.createFeed({ ...options, ...zone }));
			feed = created.feed;
			link = absoluteApiUrl(created.path);
		} catch (e) {
			appStore.showError(`Couldn't create the link. ${userFacingErrorMessage(e)}`);
			throw e;
		} finally {
			busy = false;
		}
	}

	async function setOption(key: FeedSwitch, value: boolean) {
		const previous = options[key];
		options = { ...options, [key]: value };
		if (!feed) return;
		try {
			feed = await withTimeZone(zone => calendarApi.updateOptions({ [key]: value, ...zone }));
		} catch (e) {
			options = { ...options, [key]: previous };
			appStore.showError(`Couldn't save that. ${userFacingErrorMessage(e)}`);
		}
	}

	function openInCalendarApp(url: string) {
		window.location.assign(url);
	}

	async function copyLink() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			appStore.showSuccess('Link copied');
		} catch {
			appStore.showError("Couldn't copy. Select the link and copy it yourself.");
		}
	}

	async function turnOff() {
		try {
			await calendarApi.turnOff();
			feed = null;
			link = null;
			appStore.showSuccess('Calendar link turned off');
		} catch (e) {
			appStore.showError(`Couldn't turn the link off. ${userFacingErrorMessage(e)}`);
			throw e;
		}
	}
</script>

<div id="calendar-feed" class="space-y-4 py-3">
	<div>
		<h3 class="font-medium">Calendar</h3>
		<p class="text-sm text-muted-foreground">
			See reminders, insurance renewals and loan payments in Google, Apple or Outlook Calendar.
		</p>
	</div>
	{#if loading}
		<div class="flex justify-center py-4">
			<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	{:else if loadError}
		<p class="text-sm text-destructive" role="alert">{loadError}</p>
	{:else}
		<div class="space-y-1">
			{#each SWITCHES as item (item.key)}
				<div class="flex min-h-10 items-center justify-between gap-4">
					<Label for="calendar-{item.key}" class="text-sm font-medium">{item.label}</Label>
					<Switch
						id="calendar-{item.key}"
						checked={options[item.key]}
						onCheckedChange={v => void setOption(item.key, v)}
						data-testid="calendar-{item.key}"
					/>
				</div>
			{/each}
			<p class="text-xs text-muted-foreground">
				Anyone with the link can see what's in it, and calendar apps keep a copy on their own
				servers. Vehicle names and amounts stay out unless you turn them on.
			</p>
		</div>

		{#if link}
			<div class="space-y-2" data-testid="calendar-link">
				<Label for="calendar-url">Your private calendar link</Label>
				<div class="flex gap-2">
					<Input id="calendar-url" value={link} readonly class="min-w-0 font-mono text-xs" />
					<Button variant="outline" class="h-11.5 shrink-0 rounded-full" onclick={copyLink}>
						<Copy class="mr-1 h-4 w-4" aria-hidden="true" />
						Copy link
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Shown once: copy it now. In Google Calendar, add it under Other calendars → From URL. In
					Outlook, use Add calendar → Subscribe from web.
				</p>
				{#if webcal && onApple}
					<Button
						variant="outline"
						class="h-10 rounded-full"
						onclick={() => openInCalendarApp(webcal)}
						data-testid="calendar-webcal"
					>
						Open in Apple Calendar
					</Button>
				{/if}
			</div>
		{/if}

		{#if feed}
			<p class="text-sm text-muted-foreground" data-testid="calendar-status">
				Link created {formatDate(feed.createdAt)} · {feed.lastUsedAt
					? `last used ${formatDate(feed.lastUsedAt)}`
					: 'not used yet'}
			</p>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					class="h-10 rounded-full"
					onclick={() => (confirmRotate = true)}
					disabled={busy}
					data-testid="calendar-rotate"
				>
					Get a new link
				</Button>
				<Button
					variant="outline"
					class="h-10 rounded-full text-destructive"
					onclick={() => (confirmOff = true)}
					disabled={busy}
					data-testid="calendar-off"
				>
					Turn off
				</Button>
			</div>
		{:else}
			<Button
				variant="outline"
				class="h-10 rounded-full"
				onclick={() => void createLink().catch(() => undefined)}
				disabled={busy}
				data-testid="calendar-create"
			>
				{#if busy}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />{/if}
				Create link
			</Button>
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmRotate}
	title="Get a new calendar link?"
	description="The current link stops working at once. Calendars subscribed to it need the new link."
	confirmLabel="Get a new link"
	onConfirm={createLink}
/>

<ConfirmDialog
	bind:open={confirmOff}
	title="Turn off the calendar link?"
	description="Calendars subscribed to it stop updating and its events disappear. You can create a new link at any time."
	confirmLabel="Turn off"
	onConfirm={turnOff}
/>
