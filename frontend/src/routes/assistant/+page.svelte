<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { Bot, Send, LoaderCircle, CircleAlert, User } from '@lucide/svelte';
	import { routes } from '#lib/routes.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Textarea } from '#lib/components/ui/textarea/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { settingsApi } from '#lib/services/settings-api.ts';
	import { assistantApi, type AssistantTurn } from '#lib/services/assistant-api.ts';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { oldestFirst } from '#lib/utils/provider-order.ts';

	const DISCLOSURE_KEY = 'vroom.llm.assistant-disclosed';
	const MAX_HISTORY_TURNS = 12;
	const MAX_MESSAGE_CHARS = 2000;

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
		toolsUsed?: string[];
	}

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let hasProvider = $state(false);
	let providerName = $state<string | null>(null);

	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let isSending = $state(false);
	let sendError = $state<string | null>(null);
	let scrollEl = $state<HTMLDivElement | null>(null);

	let showDisclosure = $state(false);

	async function loadProviders() {
		isLoading = true;
		try {
			const [providers, settings] = await Promise.all([
				providerApi.getProviders('llm'),
				settingsApi.getSettings().catch(() => null)
			]);
			const usable = providers.filter(p => p.status !== 'disabled').sort(oldestFirst);
			const savedId = settings?.providerDefaults?.['ai.llm'];
			hasProvider = usable.length > 0;
			providerName = settings
				? ((usable.find(p => p.id === savedId) ?? usable[0])?.displayName ?? null)
				: null;
			loadError = null;
		} catch (e) {
			loadError = userFacingErrorMessage(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(loadProviders);

	function isDisclosed(): boolean {
		return typeof localStorage !== 'undefined' && localStorage.getItem(DISCLOSURE_KEY) === '1';
	}

	function acknowledgeDisclosure() {
		try {
			localStorage.setItem(DISCLOSURE_KEY, '1');
		} catch {
			// Storage can be unavailable (private mode); the disclosure is then shown again.
		}
		showDisclosure = false;
		void send();
	}

	async function scrollToBottom() {
		await tick();
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	function trimTurn(text: string): string {
		if (text.length <= MAX_MESSAGE_CHARS) return text;
		let end = MAX_MESSAGE_CHARS - 1;
		if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
		return `${text.slice(0, end)}…`;
	}

	function toHistory(turns: ChatMessage[]): AssistantTurn[] {
		return turns
			.slice(-MAX_HISTORY_TURNS)
			.map(m => ({ role: m.role, content: trimTurn(m.content) }));
	}

	async function send() {
		const text = input.trim();
		if (!text || isSending) return;
		if (!isDisclosed()) {
			showDisclosure = true;
			return;
		}

		sendError = null;
		const history = toHistory(messages);
		messages = [...messages, { role: 'user', content: text }];
		input = '';
		isSending = true;
		await scrollToBottom();

		try {
			const reply = await assistantApi.sendMessage(text, history);
			messages = [
				...messages,
				{ role: 'assistant', content: reply.reply, toolsUsed: reply.toolsUsed }
			];
		} catch (err) {
			sendError = errorMessageFor(err);
		} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	async function retry() {
		const last = messages[messages.length - 1];
		if (!last || last.role !== 'user' || isSending) return;
		sendError = null;
		const history = toHistory(messages.slice(0, -1));
		isSending = true;
		try {
			const reply = await assistantApi.sendMessage(last.content, history);
			messages = [
				...messages,
				{ role: 'assistant', content: reply.reply, toolsUsed: reply.toolsUsed }
			];
		} catch (err) {
			sendError = errorMessageFor(err);
		} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	function errorMessageFor(err: unknown): string {
		if (err instanceof ApiError && err.code === 'NO_PROVIDER') {
			hasProvider = false;
			return 'No assistant provider is connected. Add one in Settings → Assistant (AI).';
		}
		if (err instanceof ApiError && err.statusCode === 502) {
			return "The AI provider couldn't be reached. Check the key and model in Settings, then try again.";
		}
		return userFacingErrorMessage(err);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}
</script>

<svelte:head>
	<title>Assistant - VROOM Car Tracker</title>
	<meta name="description" content="Ask an AI assistant about your vehicles and costs" />
</svelte:head>

<FormLayout>
	<PageHeader title="Assistant" description="Ask about your vehicles, costs, and reminders." />

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else if loadError}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Couldn't load the assistant</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={loadProviders}>Retry</Button>
		</div>
	{:else if !hasProvider}
		<EmptyState>
			{#snippet icon()}<Bot class="h-12 w-12 text-muted-foreground mb-4" />{/snippet}
			{#snippet title()}No assistant provider connected{/snippet}
			{#snippet description()}
				Connect a chat-AI provider to ask questions about your vehicles and costs. Bring your own
				key — the assistant is read-only and can never change your data.
			{/snippet}
			{#snippet action()}
				<Button href="{resolve(routes.settings)}#assistant-providers" class="h-10">
					Go to Settings
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4" data-testid="assistant-chat">
			{#if providerName}
				<p class="text-sm text-muted-foreground" data-testid="assistant-provider">
					Using <span class="font-medium text-foreground">{providerName}</span> ·
					<a
						href="{resolve(routes.settings)}#assistant-providers"
						aria-label="Change the assistant provider"
						class="underline underline-offset-2 hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Change
					</a>
				</p>
			{/if}
			<div
				bind:this={scrollEl}
				class="min-h-[40vh] max-h-[60vh] overflow-y-auto rounded-lg border bg-card p-4 space-y-4"
				data-testid="assistant-transcript"
			>
				{#if messages.length === 0}
					<div class="flex h-full flex-col items-center justify-center py-12 text-center">
						<Bot class="h-10 w-10 text-muted-foreground mb-2" />
						<p class="text-sm font-medium">Ask me anything about your cars</p>
						<p class="text-xs text-muted-foreground mt-1 max-w-sm">
							Try “How much did I spend on fuel this year?” or “What is my loan balance?” I read
							your data to answer — I never change it.
						</p>
					</div>
				{:else}
					{#each messages as message, i (i)}
						<div
							class="flex gap-2 {message.role === 'user' ? 'justify-end' : 'justify-start'}"
							data-testid="assistant-message"
							data-role={message.role}
						>
							{#if message.role === 'assistant'}
								<div
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"
								>
									<Bot class="h-4 w-4 text-primary" />
								</div>
							{/if}
							<div class="max-w-[80%] space-y-1">
								<div
									class="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words {message.role ===
									'user'
										? 'bg-primary text-primary-foreground'
										: 'bg-muted text-foreground'}"
								>
									{message.content}
								</div>
								{#if message.role === 'assistant' && message.toolsUsed && message.toolsUsed.length > 0}
									<div class="flex flex-wrap gap-1" data-testid="assistant-tools-used">
										{#each message.toolsUsed as tool (tool)}
											<Badge variant="secondary" class="text-xs font-normal">{tool}</Badge>
										{/each}
									</div>
								{/if}
							</div>
							{#if message.role === 'user'}
								<div
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"
								>
									<User class="h-4 w-4 text-muted-foreground" />
								</div>
							{/if}
						</div>
					{/each}
				{/if}

				{#if isSending}
					<div class="flex gap-2 justify-start" data-testid="assistant-pending">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10"
						>
							<Bot class="h-4 w-4 text-primary" />
						</div>
						<div class="rounded-lg bg-muted px-3 py-2">
							<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
						</div>
					</div>
				{/if}
			</div>

			{#if sendError}
				<div
					class="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
					data-testid="assistant-error"
				>
					<p class="text-destructive">{sendError}</p>
					<button
						type="button"
						class="self-start text-xs underline hover:text-foreground"
						onclick={retry}
					>
						Retry
					</button>
				</div>
			{/if}

			<div class="flex items-end gap-2">
				<Textarea
					bind:value={input}
					placeholder="Ask about your vehicles and costs…"
					rows={1}
					maxlength={MAX_MESSAGE_CHARS}
					class="min-h-[2.5rem] resize-none"
					disabled={isSending}
					onkeydown={onKeydown}
					data-testid="assistant-input"
				/>
				<Button
					onclick={send}
					disabled={isSending || input.trim().length === 0}
					size="icon"
					class="shrink-0"
					aria-label="Send message"
					data-testid="assistant-send"
				>
					{#if isSending}
						<LoaderCircle class="h-4 w-4 animate-spin" />
					{:else}
						<Send class="h-4 w-4" />
					{/if}
				</Button>
			</div>
		</div>
	{/if}
</FormLayout>

<AlertDialog.Root bind:open={showDisclosure}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Chat with the AI assistant</AlertDialog.Title>
			<AlertDialog.Description>
				Your question — plus the car data needed to answer it (your own vehicles, expenses, and
				summaries) — is sent to the AI provider you configured. The assistant is read-only and can
				never change your data, and VROOM stores nothing from the conversation. For maximum privacy,
				configure a self-hosted (Ollama) provider so nothing leaves your machine.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={() => (showDisclosure = false)}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={acknowledgeDisclosure}>Continue</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
