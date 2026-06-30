<script lang="ts">
	/**
	 * Assistant chat surface — llm-assistant T6.
	 *
	 * A blocking (D5) chat over the user's own car data: the user types a question, we POST it to the
	 * shipped `POST /api/v1/assistant/chat` (backend T4) via assistantApi, and render the grounded reply
	 * plus the read-only tools that ran (transparency, not trust). The assistant is READ-ONLY — it can
	 * never change data — so there is no confirm/commit step here.
	 *
	 * Four-states (R9), at the PAGE level keyed on the provider check:
	 *   loading  — checking whether an `llm` provider is configured
	 *   error    — that check failed (retry)
	 *   empty    — no `llm` provider configured (link to Settings → Assistant)
	 *   data     — the chat surface (its own send lifecycle: idle / sending-spinner / send-error+retry)
	 *
	 * SAFE RENDER (R8): the reply is shown as PLAIN TEXT with preserved whitespace (`whitespace-pre-wrap`)
	 * — a text node, never `{@html}` — so untrusted model output cannot inject markup/script. No markdown
	 * library is pulled in for v1 (plain text is the safe floor; rich markdown is a later enhancement).
	 *
	 * R7 first-use privacy disclosure: before the FIRST message ever, an AlertDialog explains the question
	 * + the data needed to answer it is sent to the configured provider (and self-hosting keeps it local).
	 * Dismissal is remembered in localStorage so it shows once (the VLM ReceiptScanButton pattern).
	 */
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { Bot, Send, LoaderCircle, CircleAlert, User } from '@lucide/svelte';
	import { routes } from '$lib/routes';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import PageHeader from '$lib/components/common/page-header.svelte';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { assistantApi, type AssistantTurn } from '$lib/services/assistant-api';
	import { ApiError } from '$lib/utils/error-handling';

	const DISCLOSURE_KEY = 'vroom.llm.assistant-disclosed';
	/** The backend caps history at 12 turns — send the most recent window so a long chat never 400s. */
	const MAX_HISTORY_TURNS = 12;

	/** A rendered chat message. `toolsUsed` is display-only (the server produces it); it is NOT part of
	 *  the AssistantTurn we send back as history (the backend accepts user/assistant turns only). */
	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
		toolsUsed?: string[];
	}

	// --- Provider-check (page-level four-states) ---
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let hasProvider = $state(false);

	// --- Chat state ---
	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let isSending = $state(false);
	let sendError = $state<string | null>(null);
	let scrollEl = $state<HTMLDivElement | null>(null);

	// --- Disclosure ---
	let showDisclosure = $state(false);

	async function loadProviders() {
		isLoading = true;
		try {
			const providers = await providerApi.getProviders('llm');
			hasProvider = providers.length > 0;
			loadError = null;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to check for an assistant provider';
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
			// localStorage may be unavailable (private mode) — proceed anyway; we just re-ask next time.
		}
		showDisclosure = false;
		void send();
	}

	/** Scroll the transcript to the newest message after the DOM settles. */
	async function scrollToBottom() {
		await tick();
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	/** Build the bounded prior transcript to send as `history` (excludes the in-flight message). */
	function buildHistory(): AssistantTurn[] {
		return messages.slice(-MAX_HISTORY_TURNS).map(m => ({ role: m.role, content: m.content }));
	}

	async function send() {
		const text = input.trim();
		if (!text || isSending) return;
		// Gate the very first message behind the privacy disclosure.
		if (!isDisclosed()) {
			showDisclosure = true;
			return;
		}

		sendError = null;
		const history = buildHistory();
		messages = [...messages, { role: 'user', content: text }];
		input = '';
		isSending = true;
		await scrollToBottom();

		try {
			const reply = await assistantApi.sendMessage(text, history);
			messages = [...messages, { role: 'assistant', content: reply.reply, toolsUsed: reply.toolsUsed }];
		} catch (err) {
			sendError = errorMessageFor(err);
		} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	/** Retry the last user message (kept in the transcript) without re-appending it. */
	async function retry() {
		const last = messages[messages.length - 1];
		if (!last || last.role !== 'user' || isSending) return;
		sendError = null;
		const history = messages.slice(0, -1).slice(-MAX_HISTORY_TURNS).map(m => ({
			role: m.role,
			content: m.content
		}));
		isSending = true;
		try {
			const reply = await assistantApi.sendMessage(last.content, history);
			messages = [...messages, { role: 'assistant', content: reply.reply, toolsUsed: reply.toolsUsed }];
		} catch (err) {
			sendError = errorMessageFor(err);
		} finally {
			isSending = false;
			await scrollToBottom();
		}
	}

	function errorMessageFor(err: unknown): string {
		if (err instanceof ApiError && err.statusCode === 400) {
			return 'No assistant provider is set up. Add one in Settings → Assistant.';
		}
		if (err instanceof ApiError && err.statusCode === 502) {
			return 'The AI provider could not be reached. Check the key/model in Settings, then try again.';
		}
		return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
	}

	/** Enter sends; Shift+Enter inserts a newline (the standard chat-input idiom). */
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
				<p class="font-medium">Could not load the assistant</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={loadProviders}>Retry</Button>
		</div>
	{:else if !hasProvider}
		<EmptyState>
			{#snippet icon()}<Bot class="h-12 w-12 text-muted-foreground mb-4" />{/snippet}
			{#snippet title()}No assistant provider configured{/snippet}
			{#snippet description()}
				Connect a chat-AI provider to ask questions about your vehicles and costs. Bring your own
				key — the assistant is read-only and can never change your data.
			{/snippet}
			{#snippet action()}
				<Button href={resolve(routes.settings)}>Go to Settings</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4" data-testid="assistant-chat">
			<!-- Transcript -->
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
							Try “How much did I spend on fuel this year?” or “What is my loan balance?” I read your
							data to answer — I never change it.
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
								>{message.content}</div>
								{#if message.role === 'assistant' && message.toolsUsed && message.toolsUsed.length > 0}
									<div class="flex flex-wrap gap-1" data-testid="assistant-tools-used">
										{#each message.toolsUsed as tool (tool)}
											<Badge variant="secondary" class="text-[10px] font-normal">{tool}</Badge>
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
						<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
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
						Try again
					</button>
				</div>
			{/if}

			<!-- Input -->
			<div class="flex items-end gap-2">
				<Textarea
					bind:value={input}
					placeholder="Ask about your vehicles and costs…"
					rows={1}
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
