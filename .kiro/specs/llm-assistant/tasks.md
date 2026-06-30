# LLM Assistant — Tasks

> Backend-first per CLAUDE.md (provider-domain → strategy registry + read-tool layer → chat route/
> orchestrator → frontend eyes-on tail), exactly like vlm-receipt-parsing / vehicle-sharing. **The SPEC
> is greenlit-to-spec (Angelo decision 23, 2026-06-29).** The fork-free backend slices (T1–T3) are
> pre-authorized; **T0 is a SIGN-OFF GATE for the D1–D6 product/UX forks** in `requirements.md` — the
> slices that depend on a fork (the D1 adapter set, D2 read-only-vs-actions, D3 history persistence, D4
> tool allowlist shape, D5 streaming, D6 caps) wait on its ruling. One task per `feature` cycle, each
> independently verified via `bun run validate:local` both sides; never commit red.
>
> KEY GROUNDING (do not re-derive): an LLM assistant is a NEW PROVIDER DOMAIN (`domain:'llm'`) in the
> EXISTING `user_providers` system — encrypted bring-your-own credentials via `utils/encryption.ts`, a
> per-type strategy registry mirroring `domains/vlm/`, secrets stripped from responses. **NO schema
> migration in v1** (`user_providers` is domain-agnostic; D3 keeps history ephemeral → no new table). The
> chat route runs a BOUNDED tool-calling loop over a FIXED allowlist of READ-ONLY, userId-scoped tools
> (thin wrappers over the existing analytics/repos); every tool arg is Zod-validated; authorization is
> NEVER delegated to the model (the session userId, never a model-supplied id). **v1 is READ-ONLY — no
> write tool exists** (design §8.1). The model output is UNTRUSTED (ARCC GenAI-tool-use): validated args,
> safe-rendered reply, never a security decision.

## Phase 0 — sign-off (gates the fork-dependent slices)
- [ ] **T0 — Angelo rules D1–D6** (`requirements.md`). Each has a RECOMMENDED option; an "ACK" takes the
      recommendation. D1 adapter set (recommend openai-compatible + anthropic + gemini + ollama, mirroring
      the shipped VLM set), D2 read-only-vs-gated-actions (recommend READ-ONLY hard in v1), D3 history
      ephemeral-vs-persisted (recommend ephemeral), D4 tool allowlist (recommend the 8 aggregate read
      tools, no raw-row dumps), D5 streaming-vs-blocking (recommend blocking in v1), D6 caps (recommend
      K=5 tool calls / T=4 turns + bounded input). **T1–T2 below do NOT depend on T0 and may build first**
      (the provider-domain plumbing + the read-tool wrappers are fork-free); T3+ honors the ruling.

## Phase 1 — the LLM provider domain (fork-free; encrypted bring-your-own credential plumbing)
- [x] **T1 — `llm`-domain provider validation + CRUD wiring (C533, commits f85f076 + a032712).** Done via
      a behavior-preserving generalization of the vlm provider-config layer in `providers/routes.ts`:
      `VLM_PROVIDER_TYPES`→`MODEL_PROVIDER_TYPES` + `isModelProviderType`; added `MODEL_DOMAINS`=[vlm,llm] +
      `isModelDomain`; `validateVlm*`→shared `validateModel*` (one model/key/baseUrl gate, wording kept
      stable); the domain↔type guard now keys on `isModelDomain` (a model type ⇒ domain vlm OR llm; a model
      domain rejects a storage type) — so the SAME 4 types serve both domains. Back-compat aliases keep the
      vlm call sites + the C509 guard test unchanged (all symbols internal to routes.ts). GUARD
      `llm-provider-config.test.ts` (12 cases): key ENCRYPTED + STRIPPED; missing model/key/baseUrl 400 at
      create AND PUT; config-only PUT keeps the key; ollama-keyless; a model type accepted in llm + rejected
      in a non-model domain + a storage type rejected in llm; an llm+vlm same-type pair coexist. The vlm
      guard stays GREEN (11 pass — proves behavior-preserving). Backend validate:local GREEN (2233 pass, +12).
- [ ] **T2 — The read-tool layer + the strategy-registry skeleton (fork-free).** `domains/llm/`:
      `llm-provider.ts` (the `LlmProvider` chat interface — adapters are dumb transport), `tools.ts` (the
      FIXED read-only allowlist: each entry = { name, Zod argSchema, run(args, userId) } wrapping an
      EXISTING userId-scoped seam — `vehicleRepository.findByUserId`, `expenseRepository.getSummary`,
      `analyticsRepository.getFuelStats/getCrossVehicle/getSummary/getFinancing/getInsurance`,
      `reminderRepository.findByUserId`), and `registry.ts` (`getLlmProvider(row)` decrypt→switch→throw on
      unknown; adapter builders throwing a clear T3-placeholder). **GUARD `llm-tools.test.ts`:** each tool
      runs userId-scoped (a tool invoked with userId A never returns userId B's rows — the IDOR/confused-
      deputy guard, the load-bearing safety test); a model-supplied `vehicleId` for another user is
      rejected/scoped via `requireVehicleRead`; the `range` enum is allow-listed (a bad range → Zod
      reject); every tool returns aggregates (no raw-row dump). This is the safety core — test it FIRST.

## Phase 2 — the adapters + the orchestrator (honors the D1/D5/D6 ruling)
- [ ] **T3a — The OpenAI-compatible chat+tools adapter (FORK-FREE — the common denominator).**
      `openai-compatible.ts`: `chat({messages, tools})` → POST `{baseUrl}/chat/completions` with the
      `tools[]` function schemas; normalizes the response to `{ text?, toolCalls? }`; dumb transport
      (executes NOTHING; the orchestrator validates+runs); Bearer-with-key / omitted-for-keyless-ollama;
      non-2xx/network/timeout THROWS (route→502). Covers OpenAI + Ollama + gateways via baseUrl. GUARD
      `openai-compatible-llm.test.ts` (stubbed fetch — request shape incl. tools[], auth, the text-vs-
      toolCalls normalization, failure honesty). Built ahead of the T0 ruling — the common denominator of
      every D1 option, zero rework risk.
- [ ] **T3b — The Anthropic + Gemini chat+tools adapters (honors D1).** `anthropic.ts` (Claude tool-use,
      /v1/messages, x-api-key + anthropic-version) + `gemini.ts` (functionDeclarations, generateContent,
      ?key=). Both mirror the T3a dumb-transport contract, normalizing each provider's tool-call wire shape
      to the one `ChatResult.toolCalls`. GUARDS: stubbed-fetch request-shape + auth + normalization +
      failure honesty; registry test updated (all 4 D1 types resolve a live adapter).
- [ ] **T4 — The bounded tool-calling orchestrator + `POST /api/v1/assistant/chat` (honors D2/D5/D6).**
      `orchestrator.ts`: the loop (design §4) — for each turn, call the provider; if toolCalls, for each
      (≤K total): allowlist-check the name → Zod-validate the args → run via the tool under the SESSION
      userId → feed the result back; cap at T turns; loop-exhausted → an honest bounded reply. Mount
      `assistant/routes.ts` at `/api/v1/assistant`: requireAuth + rate-limit + body-limit + a bounded
      message length; resolve the enabled `llm` provider (none→400); return `{ reply, toolsUsed }`; PERSIST
      NOTHING; key never echoed, message/results never logged. **GUARD `assistant-chat-route.test.ts`
      (real HTTP harness, adapter fetch stubbed to script a tool-call then a final answer):** a clean
      tool-call→answer round-trip; an invalid tool name rejected; bad tool args Zod-rejected; the K/T caps
      enforced (a scripted infinite tool-loop terminates with the honest reply); no-provider 400; provider
      502; key not echoed; unauth 401; the IDOR guard (a tool result is the session user's data only).

## Phase 3 — frontend (eyes-on tail, R10 — live-LLM + Playwright-blocked → "code-complete, eyes-on pending")
- [ ] **T5a — `assistant-api.ts` client (FORK-FREE).** `assistantApi.sendMessage(message, history) →
      { reply, toolsUsed }` over the shipped `POST /api/v1/assistant/chat`. Mirrors the C514 vlm-api
      pattern. GUARD `assistant-api.test.ts` (mocked apiClient — endpoint + payload + the {reply,toolsUsed}
      unwrap + error propagation). Thin wrapper over the contract-fixed route; independent of the forks.
- [ ] **T5b — The LLM-provider settings UI (honors D1).** An `LlmProvidersCard` (or a domain-parameterized
      generalization of the shipped `VlmProvidersCard`) on /settings: type + apiKey [write-only] + model +
      baseUrl, the D1 set; reuses `provider-api.ts`. canSave mirrors the backend gate; four-states;
      eyes-on (boot + shot + Read the PNG).
- [ ] **T6 — The assistant chat surface (honors D5).** A `/assistant` route (or dashboard panel): message
      list + input + send; four-states (loading/error/empty-no-provider/data); reply rendered as SAFE
      markdown (R8); a one-time privacy disclosure before the first message (R7, the VLM disclosure
      pattern). Blocking (D5) — spinner while awaiting the reply. Eyes-on: drive a message with a stubbed
      chat route, assert the bubble renders + toolsUsed shown, zero console errors.
- [ ] **T7 — Round-trip e2e + DoD.** With a MOCKED llm provider (adapter fetch stubbed to script a
      tool-call then an answer): send a message → assert the orchestrator ran the (stubbed) tool → the
      reply renders. The live-LLM leg stays eyes-on-pending. Feature-DoD: both sides validate:local green,
      the e2e green, eyes-on the chat surface (boot + shot.sh + Read the PNG), the privacy disclosure
      present, the IDOR/tool-scope guard green. Tick the feature done.

## Notes
- **NO schema migration in v1** — `user_providers` is domain-agnostic; an `llm` row needs no new column.
  D3 keeps history EPHEMERAL → no `conversations` table, no backup surface, session-isolation trivially met.
- **v1 is READ-ONLY** — the tool allowlist contains NO mutating tool. There is no model-driven write path
  to secure (design §8.1). A gated, human-confirmed ACTION assistant is a SEPARATE later spec.
- **Authorization is never the model's** — every tool runs with the session userId; a model-supplied id
  can never widen scope (the IDOR discipline, tested in T2 + T4). This is the single most important guard.
- **The orchestrator is the safety surface** — allowlist + Zod-validated args + bounded loop + honest
  exhaustion. T2 (tool scope) + T4 (the loop + caps + IDOR) are where the ARCC controls are enforced and
  must be tested first/hardest.
- WIP=1: finish this feature (or hand off the eyes-on tail) before starting the next greenlit spec
  (location / push / calendar / Photos→auto-expense).
