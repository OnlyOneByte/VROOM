<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { DoorOpen, LoaderCircle, Lock } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { FormFieldError } from '#lib/components/ui/form-field/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { signupApi, type SignupMode, type SignupSettings } from '#lib/services/signup-api.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	interface Props {
		settings: SignupSettings;
		onChange: (_settings: SignupSettings) => void;
	}

	let { settings, onChange }: Props = $props();

	const MODES: { value: SignupMode; label: string; detail: string }[] = [
		{
			value: 'invite',
			label: 'Invite only',
			detail: 'People you invite, and people invited to share a vehicle.'
		},
		{
			value: 'approval',
			label: 'Approval',
			detail: 'Anyone can sign up, then waits until an admin approves them.'
		},
		{ value: 'open', label: 'Open', detail: 'Anyone who can reach this server can sign up.' },
		{ value: 'closed', label: 'Closed', detail: 'Nobody new, invites included.' }
	];

	let mode = $state<SignupMode>(untrack(() => settings.mode));
	let domains = $state(untrack(() => settings.allowedDomains.join(', ')));
	let savingMode = $state(false);
	let savingDomains = $state(false);
	let domainsError = $state<string | null>(null);
	let domainsInput = $state<HTMLInputElement | null>(null);

	let modeChanged = $derived(mode !== settings.mode);
	let domainsChanged = $derived(domains.trim() !== settings.allowedDomains.join(', '));

	async function saveMode() {
		savingMode = true;
		try {
			onChange(await signupApi.updateSettings({ mode }));
			appStore.showSuccess('Sign-up mode saved');
			await tick();
			document.getElementById(`signup-mode-${mode}`)?.focus();
		} catch (e) {
			appStore.showError(`Couldn’t save the sign-up mode. ${userFacingErrorMessage(e)}`);
		} finally {
			savingMode = false;
		}
	}

	async function saveDomains(event: SubmitEvent) {
		event.preventDefault();
		if (savingDomains || !domainsChanged) return;
		domainsError = null;
		savingDomains = true;
		const allowedDomains = domains
			.split(',')
			.map(d => d.trim())
			.filter(Boolean);
		try {
			const saved = await signupApi.updateSettings({ allowedDomains });
			onChange(saved);
			domains = saved.allowedDomains.join(', ');
			appStore.showSuccess('Allowed domains saved');
		} catch (e) {
			domainsError = userFacingErrorMessage(e);
		} finally {
			savingDomains = false;
		}
		await tick();
		domainsInput?.focus();
	}
</script>

<Card id="who-can-join">
	<CardHeader>
		<div class="flex items-center gap-2">
			<DoorOpen class="h-5 w-5 text-muted-foreground" />
			<CardTitle level={2}>Who can join</CardTitle>
		</div>
		<CardDescription>The first account on a server is always its admin.</CardDescription>
	</CardHeader>
	<CardContent class="space-y-6">
		<fieldset class="space-y-3" disabled={settings.modeLocked}>
			<legend class="sr-only">Sign-up mode</legend>
			<RadioGroup.Root bind:value={mode}>
				{#each MODES as option (option.value)}
					<div class="flex items-start gap-3 py-1">
						<RadioGroup.Item
							value={option.value}
							id="signup-mode-{option.value}"
							class="mt-0.5"
							disabled={settings.modeLocked}
							data-testid="signup-mode-{option.value}"
						/>
						<Label for="signup-mode-{option.value}" class="block font-normal">
							<span class="block font-medium">{option.label}</span>
							<span class="block text-sm text-muted-foreground">{option.detail}</span>
						</Label>
					</div>
				{/each}
			</RadioGroup.Root>
			{#if settings.modeLocked}
				<p
					class="flex items-center gap-2 text-sm text-muted-foreground"
					data-testid="signup-mode-locked"
				>
					<Lock class="h-4 w-4 shrink-0" />
					Set by <code class="font-mono text-xs">SIGNUP_MODE</code> on the server.
				</p>
			{:else if modeChanged || savingMode}
				<Button
					variant="outline"
					class="h-10"
					disabled={savingMode}
					onclick={() => void saveMode()}
				>
					{#if savingMode}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
					Save mode
				</Button>
			{/if}
		</fieldset>

		<form class="space-y-2" onsubmit={saveDomains} novalidate>
			<Label for="signup-domains">Allowed email domains (optional)</Label>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Input
					id="signup-domains"
					bind:ref={domainsInput}
					bind:value={domains}
					placeholder="example.com, example.org"
					autocomplete="off"
					readonly={settings.domainsLocked}
					aria-invalid={domainsError ? 'true' : undefined}
					aria-describedby="signup-domains-help{domainsError ? ' signup-domains-error' : ''}"
					class="min-w-0"
				/>
				{#if !settings.domainsLocked && (domainsChanged || savingDomains)}
					<Button type="submit" variant="outline" class="h-10 shrink-0" aria-busy={savingDomains}>
						{#if savingDomains}<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />{/if}
						Save domains
					</Button>
				{/if}
			</div>
			{#if domainsError}
				<FormFieldError id="signup-domains-error">{domainsError}</FormFieldError>
			{/if}
			<p id="signup-domains-help" class="text-xs text-muted-foreground">
				{#if settings.domainsLocked}
					Set by <code class="font-mono">SIGNUP_ALLOWED_DOMAINS</code> on the server.
				{:else}
					Leave empty to allow any email. An invite from you admits any email.
				{/if}
			</p>
		</form>
	</CardContent>
</Card>
