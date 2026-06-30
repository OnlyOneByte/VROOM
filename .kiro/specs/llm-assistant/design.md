# LLM Assistant — Design

> DRAFT (2026-06-30), paired with `requirements.md`. Backend-first per CLAUDE.md (config/provider-domain
> → tool layer → chat route/validation → frontend eyes-on tail). **Nothing that depends on a product
> fork (D1–D6) builds until Angelo rules it;** the SPEC + the fork-free backend slices (the provider
> domain + the read-tool wrappers) are greenlit-to-spec (decision 23).
>
> Grounded against the live code (2026-06-30):
> - `backend/src/utils/encryption.ts` — AES-256-GCM `encrypt()`/`decrypt()`, key from
>   `PROVIDER_ENCRYPTION_KEY`. The `llm` api key reuses this verbatim (as `vlm` + storage do).
> - `backend/src/db/schema.ts` — `user_providers` is **domain-agnostic** (`domain` + `providerType` +
>   encrypted `credentials` + json `config`). A new `domain:'llm'` needs NO schema change.
> - `backend/src/api/providers/routes.ts` — generic provider CRUD; `validateVlmProviderConfig` (shipped
>   C509) is the per-type gate pattern to generalize for `llm` (same shape: model required, apiKey
>   required for non-ollama, baseUrl required for ollama/openai-compatible).
> - `backend/src/api/providers/domains/vlm/` — the provider STRATEGY pattern shipped for VLM
>   (`vlm-provider.ts` interface + `openai-compatible.ts`/`anthropic.ts`/`gemini.ts` adapters +
>   `registry.ts` decrypt→switch). The `llm` domain mirrors this EXACTLY, with a chat+tools interface
>   instead of an extract interface.
> - `backend/src/api/analytics/repository.ts` — the data the read-tools wrap, ALREADY userId-scoped:
>   `getSummary(userId, range)`, `getQuickStats(userId, range)`, `getFuelStats(scopeId, range)`,
>   `getCrossVehicle(userId, range)`, `getFinancing(userId)`, `getInsurance(userId)`,
>   `getVehicleTCO(scopeId, vehicleId, year)`.
> - `backend/src/api/vehicles/repository.ts:findByUserId(userId)` + `reminders/repository.ts:findByUserId
>   /findOverdue(userId)` + `financing/repository.ts:computeBalance` — the rest of the read seams.
> - `backend/src/api/expenses/repository.ts:getSummary(filters)` — expense aggregation (userId-scoped).

## §0 — The one-line architecture
An LLM assistant is a new PROVIDER DOMAIN (`llm`) in the SAME `user_providers` system VLM + storage use —
encrypted bring-your-own credentials, a per-type strategy registry, secrets stripped from responses. The
chat route resolves the user's `llm` provider and runs a BOUNDED tool-calling loop: the model may call a
FIXED allowlist of READ-ONLY, userId-scoped data tools (thin wrappers over the EXISTING analytics/repos);
every tool call's args are Zod-validated and executed under the SESSION user's id; the loop is hard-capped
at K tool calls / T turns; the model's final grounded text is returned. **READ-ONLY. No new table. No
auto-write. Authorization is never delegated to the model.**

## §1 — Config + the LLM provider domain (no schema migration)
A `domain:'llm'` row: `providerType` from the D1 set, encrypted `credentials = { apiKey }`,
`config = { model, baseUrl? }` — identical shape to a `vlm` row. **Zero schema change.**
```ts
// { domain: 'llm', providerType: 'openai-compatible'|'anthropic'|'gemini'|'ollama',
//   credentials: encrypt(JSON.stringify({ apiKey })),   // ollama may be keyless
//   config: { model: 'gpt-4o'|'claude-3-5-sonnet'|'gemini-1.5-pro'|'llama3.1', baseUrl?: string } }
```

## §2 — Provider validation (generalize `validateVlmProviderConfig`)
The C509 `validateVlmProviderConfig` (model required; apiKey required for non-ollama; baseUrl required for
ollama/openai-compatible) is domain-agnostic in substance — lift it to a shared `validateProviderModelConfig`
that both `vlm` and `llm` call (arch dedup, behavior-preserving), or add a parallel `llm` branch mirroring
it. The generic `POST/PUT /api/v1/providers` flow is otherwise UNCHANGED (encrypts creds, strips them,
userId-scoped). A domain↔type guard (an `llm` type ⇒ `domain:'llm'`) mirrors the vlm one.

## §3 — The LLM strategy registry (`api/providers/domains/llm/`, new — mirrors vlm/)
```
domains/llm/
  llm-provider.ts   // interface LlmProvider { chat(req: ChatRequest): Promise<ChatResult> }
                    //   ChatRequest = { messages, tools, toolChoice }; ChatResult = { text?, toolCalls? }
  openai-compatible.ts  // POST {baseUrl}/chat/completions with tools[] (covers OpenAI + Ollama + gateways)
  anthropic.ts          // POST /v1/messages with tools[] (Claude tool-use; x-api-key + anthropic-version)
  gemini.ts             // generateContent with functionDeclarations (?key= query param)
  registry.ts           // getLlmProvider(row): decrypt creds + switch on providerType → LlmProvider
  tools.ts              // the FIXED read-only tool allowlist: name → { zodSchema, run(args, userId) }
  orchestrator.ts       // the bounded tool-calling loop (the load-bearing safety surface, §4)
```
- `getLlmProvider` mirrors `vlm/registry.ts:getVlmProvider` EXACTLY: decrypt `row.credentials`, JSON.parse,
  switch on `row.providerType`, throw on unknown. One typed interface; one adapter per type.
- Each adapter is DUMB TRANSPORT: it sends the messages + the tool schemas in the provider's wire format
  and returns either assistant text OR a list of requested tool-calls (name + raw JSON args). It does NOT
  execute tools and does NOT trust args — the orchestrator validates + runs them. Provider-specific
  tool-call wire shapes are normalized to the one `ChatResult.toolCalls` shape in the adapter.

## §4 — The tool-calling orchestrator (the load-bearing safety surface; ARCC GenAI-tool-use + SAX-04)
```
chat(userId, message, history):
  messages = [systemPrompt, ...boundedHistory, userMessage]
  for turn in 1..T:                              // hard turn cap (D6)
    result = provider.chat({ messages, tools: TOOL_SCHEMAS })
    if result.text and no toolCalls: return result.text     // final grounded answer
    for call in result.toolCalls (≤ K total this request):  // hard tool-call cap (D6)
      tool = ALLOWLIST[call.name]                # (a) name MUST be in the allowlist, else reject
      if !tool: push a tool-error message; continue
      args = tool.schema.safeParse(call.argsJson)# (b) STRICT Zod validation BEFORE execution
      if !args.success: push a validation-error message; continue
      out = await tool.run(args.data, userId)    # (c) run via the EXISTING repo, userId from the SESSION
      push { role:'tool', name, content: JSON.stringify(out) }   # (d) feed the result back
  return a bounded "could not complete" message  // loop exhausted → honest, not a fake success
```
The four ARCC controls, inline:
- **(a) allowlist** — the model can only ever name a tool we pre-specified; an invented tool name is
  rejected (ARCC "all structured calls pre-specified").
- **(b) typed validation** — args are parsed to a typed object via Zod (enums allow-listed, ints bounded,
  ranges constrained) and passed as an OBJECT to the repo — never a string concatenated into a query
  (ARCC AIQi: "always build queries as objects, never accept a pre-serialized object from the GenAI").
- **(c) session-scoped execution** — `tool.run(args, userId)` takes the userId from the authenticated
  request context, NOT from the model's args. No tool argument is a userId/ownerId. The model cannot
  reach another user's data (ARCC confused-deputy / "authorization never derived from model output").
- **(d) bounded loop** — ≤K tool calls + ≤T turns (D6); loop exhaustion returns an honest message, never a
  fabricated answer (anti-fail-open #43/#44/#144).

### The read-only tool allowlist (D4 — every entry wraps an EXISTING userId-scoped seam)
```ts
TOOL_ALLOWLIST = {
  listVehicles:        { schema: z.object({}),                          run: (a,uid) => vehicleRepository.findByUserId(uid) },
  getExpenseSummary:   { schema: RangeVehicle,                          run: (a,uid) => expenseRepository.getSummary({ userId: uid, ...a }) },
  getFuelStats:        { schema: RangeVehicle,                          run: (a,uid) => analyticsRepository.getFuelStats(scope(uid,a), a.range) },
  getCrossVehicle:     { schema: Range,                                 run: (a,uid) => analyticsRepository.getCrossVehicle(uid, a.range) },
  getAnalyticsSummary: { schema: Range,                                 run: (a,uid) => analyticsRepository.getSummary(uid, a.range) },
  getFinancingState:   { schema: z.object({}),                          run: (a,uid) => analyticsRepository.getFinancing(uid) },
  getInsuranceState:   { schema: z.object({}),                          run: (a,uid) => analyticsRepository.getInsurance(uid) },
  getUpcomingReminders:{ schema: z.object({}),                          run: (a,uid) => reminderRepository.findByUserId(uid, { active: true }) },
}
// RangeVehicle = z.object({ range: z.enum(['30d','90d','ytd','12mo','all']), vehicleId: z.string().optional() })
// vehicleId, if given, is re-checked to belong to uid (the existing requireVehicleRead / resolveVehicleScope
// guard) — a model-supplied vehicleId can never widen scope.
```
- All return AGGREGATES / summaries (data-minimization, D4) — not raw expense-row dumps in v1.
- `range` is an allow-listed enum (not a free date string) → the model cannot inject; the wrapper maps it
  to the concrete start/end the routes already compute.

## §5 — The chat route (`POST /api/v1/assistant/chat` — new)
```
body (json): { message: string (≤ maxLen, SAX-04), history?: {role,content}[] (bounded window) }
  → requireAuth (existing) + rate-limit + body-limit middleware (existing, D6)
  → resolve the user's enabled domain:'llm' provider (none → actionable 400)
  → orchestrator.chat(user.id, message, history)   // §4, the bounded loop
  → return { reply: string, toolsUsed: string[] }  // toolsUsed = which tools ran (transparency, not trust)
  → PERSIST NOTHING (D3 ephemeral)
```
- Errors: no provider → 400 (link to add); provider HTTP/timeout → 502 (honest, never a faked reply);
  loop-exhausted → 200 with a bounded "I could not fully answer that" reply (not an error, not a fake).
- The api key is never echoed; the user message + tool results are never logged (R7/SAX-06).
- D5: v1 is BLOCKING (one request → final reply). Streaming (SSE) is a fast-follow that reuses the same
  orchestrator (emit deltas instead of buffering) — no contract change to the tool layer.

## §6 — Frontend (eyes-on tail, R10 — Playwright/live-LLM-blocked → "code-complete, eyes-on pending")
- `assistant-api.ts` client (the C149/C163 service pattern): `sendMessage(message, history) → { reply, toolsUsed }`.
  Provider CRUD reuses the existing `providerApi` (getProviders('llm')/create/update/delete).
- An LLM-provider section in settings — REUSE the shipped `VlmProvidersCard` pattern (type + apiKey
  [write-only] + model + baseUrl); generalize it to a domain-parameterized provider card or clone it.
- An assistant chat surface (a `/assistant` route or a dashboard panel): message list (user + assistant
  bubbles) + an input + send. Four-states: loading (awaiting reply, spinner), error (provider failure —
  retry, never blocked), empty (no provider configured → link to settings), data (the conversation).
  The reply renders as SAFE markdown (no raw HTML, R8). A one-time privacy disclosure before the first
  message (R7): "Chatting sends your question + the data needed to answer it to <provider>. For maximum
  privacy, use a self-hosted model." Dismissal remembered in localStorage (the VLM R7 pattern).
- e2e: with a MOCKED llm provider (the live call needs a real key/host — harness-blocked), drive
  send-message → the orchestrator calls a stubbed tool → assert the reply renders + `toolsUsed` is shown.
  Exercises the full FE→BE→tool-loop→reply seam (NORTH_STAR #3); the live-LLM leg stays eyes-on-pending.

## §7 — ARCC governance mapping (queried 2026-06-30 BEFORE this design; citation-by-citation)
The feature feeds user data to an external LLM and gives that LLM agency (tool use). The fired domains:

1. **SAX-03 — secrets management.** → **Control:** the api key reuses the EXISTING `utils/encryption.ts`
   AES-256-GCM seam + `PROVIDER_ENCRYPTION_KEY`, stored in `user_providers.credentials` (encrypted),
   stripped from every response, never logged. SAME audited control as storage + vlm. No new crypto.
2. **SAX-06 — PII & third-party data handling.** → **Control:** data-minimized requests (only the message
   + bounded transcript + the tool RESULTS the model asked for — the user's own aggregates, no raw bulk
   dump); TLS; NO server-side retention (D3 ephemeral); bring-your-own provider/key (the user is the data
   controller); a first-use disclosure + the self-hosted (no-data-leaves-host) option.
3. **SAX-04 — GenAI input validation.** → **Control:** a bounded max message length + a bounded transcript
   window (input-length cap); a fixed structured system prompt (prompt hardening); EVERY model tool-call
   arg validated against a strict Zod schema before the tool runs; the model's output is never used for a
   security decision. (Bedrock Guardrails / WAF are the AWS-hosted instantiation; the portable
   requirement — bounded + validated input, validated tool args, structured prompt — is met in-app.)
4. **GenAI tool-use / agency (AIRF/AICi/AIQi).** → **Control:** the model gets a FIXED allowlist of
   READ-ONLY typed tools — NO shell, NO interpreter, NO URL-fetcher, NO raw SQL (the exact primitives the
   ARCC examples exploit). Tool args are parsed to OBJECTS via Zod and passed to the repo as objects (the
   AIQi remediation: "always build queries as objects, never accept a pre-serialized object from the
   GenAI"). The loop is hard-capped (§4/D6).
5. **Confused-deputy / authorization (do-not-trust-output).** → **Control:** every tool executes with the
   SESSION user's id from the request context, never a model-supplied id; a model-supplied `vehicleId` is
   re-checked against the user via the existing `requireVehicleRead`/`resolveVehicleScope` guard. The model
   can only ever read the requesting user's own data — the IDOR discipline from vehicle-sharing, applied to
   the tool layer.
6. **Per-user session isolation.** → **Control:** trivially satisfied in v1 — history is EPHEMERAL (D3,
   client-held); there is no server-stored conversation to leak across users. If D3 later persists history,
   that table is userId-scoped with the same IDOR guard + a backup round-trip.

## §8 — Risk register
1. **Model-driven bad WRITE.** Mitigation: **v1 is read-only — there is NO write tool.** The entire
   class is out of scope by construction (R4/D2). A future action spec adds human-confirmed writes.
2. **Confused-deputy cross-user read.** Mitigation: userId from the session, never the model; vehicleId
   re-checked (R5/§7.5). Pinned by an IDOR test on the tool layer.
3. **AI query/command injection.** Mitigation: no raw-query/shell/fetch tool; typed Zod args → object
   params into the existing repos (§4/§7.4).
4. **Runaway loop → API-cost / DB hammer.** Mitigation: ≤K tool calls + ≤T turns + rate-limit + bounded
   input (D6). Cost lands on the user's own key.
5. **API key leak.** Mitigation: encrypted at rest, write-only UI, stripped from responses, never logged
   (R6 — the audited storage/vlm discipline).
6. **PII egress.** Mitigation: data-minimized + no retention + disclosure + self-hosted option (R7/§7.2).
7. **Fail-open dishonesty.** Mitigation: provider failure → 502 + a clear FE error; loop-exhausted → an
   honest bounded reply — never a fabricated answer (R8, #43/#44/#144).
8. **Untrusted output rendered unsafely (XSS).** Mitigation: the reply renders as safe markdown / plain
   text, no raw HTML injection, never fed to another system (R8).
9. **The C151 async-tx footgun** — N/A in v1 (the chat route persists nothing; all tools are reads).
