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
- [x] **T0 — Angelo ACK all recommended (2026-06-30).** D1 = OpenAI-compatible + Anthropic + Gemini + Ollama
      (the shipped set — all live); D2 = READ-ONLY hard in v1 (no write tool); D3 = ephemeral history (no
      table); D4 = the 8 aggregate read tools, no raw-row dumps; D5 = blocking in v1 (streaming a fast-follow);
      D6 = K=5 tool calls / T=4 turns + bounded input. The shipped backend (T1-T4) + T5a already used exactly
      these recommended values, so **NO rework** — the ruling RATIFIES the built defaults. The FE tail (T5b/T6/
      T7) is now UNBLOCKED. Do NOT re-escalate (settled). [Original recommended-option text preserved in git
      history / the C532 LEDGER entry.] **T1–T2 below do NOT depend on T0 and may build first**
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
- [x] **T2 — The read-tool layer + the LlmProvider interface (C534, commits b587f9a + ef3d99c + 6d301b9).**
      `domains/llm/`: `llm-provider.ts` (the `LlmProvider` chat interface — adapters are dumb transport,
      return normalized `{text?, toolCalls?}`, NEVER execute/trust args) + `tools.ts` (the FIXED read-only
      allowlist: 8 tools, each = { name, description, Zod argSchema, run(args, userId, nowMs) } wrapping an
      EXISTING userId-scoped seam — vehicleRepository.findByUserId, expenseRepository.getSummary,
      analyticsRepository.getFuelStats/getSummary/getCrossVehicle/getFinancing/getInsurance,
      reminderRepository.findByUserId; the `range` is an allow-listed enum mapped to a bounded {start,end};
      a model-supplied vehicleId is scope-checked via requireVehicleRead; returns aggregates not raw-row
      dumps; the allowlist is FROZEN; toolDefinitions emits bounded JSON-schemas). The registry + adapter
      builders are deferred to T3 (they need the adapter classes). **GUARD `llm-tools.test.ts` (9 cases):**
      userId-scoping (user A never sees user B's rows); the confused-deputy guard (another user's vehicleId
      → NotFoundError on getExpenseSummary + getFuelStats); own-vehicle scope allowed; the range enum
      rejects a bad/injection value; the frozen 8-tool set; bounded JSON-schemas (additionalProperties:false).
      THE SAFETY CORE — built + tested first. Backend validate:local GREEN.

## Phase 2 — the adapters + the orchestrator (honors the D1/D5/D6 ruling)
- [x] **T3a — The OpenAI-compatible chat+tools adapter + the registry (C535, commits 6d9d466 + 6537917 + ee9f408).**
      `openai-compatible.ts`: `chat({messages, tools})` → POST `{baseUrl}/chat/completions` with the `tools[]`
      function schemas; normalizes the response to `{ text?, toolCalls? }` (tool_calls→toolCalls name+RAW args /
      content→text / null→text:''); dumb transport (executes NOTHING; the orchestrator validates+runs);
      Bearer-with-key / omitted-for-keyless-ollama; temp 0; 60s timeout; non-2xx/network/timeout THROWS
      (route→502). `registry.ts`: `getLlmProvider(row)` decrypt→switch (resolveLlmSettings re-validates) — live
      for openai-compatible + ollama, a clear T3b-not-yet placeholder for anthropic + gemini, Unsupported for an
      unknown type. GUARD `openai-compatible-llm.test.ts` (15 cases, stubbed fetch — request shape incl. tools[]
      + the tool-result wire mapping, auth keyed/keyless, the text-vs-toolCalls normalization, failure honesty,
      + the registry dispatch/placeholder/unknown). Built ahead of the T0 ruling — the common denominator of
      every D1 option, zero rework risk. Backend validate:local GREEN (2256 pass, +15).
- [x] **T3b — The Anthropic + Gemini chat+tools adapters (C536, commits 279f735 + a47e2d5 + 9a999c0 + db07db9).**
      `anthropic.ts` (Claude tool-use: /v1/messages, x-api-key + anthropic-version NOT Bearer; system lifted to
      the top-level field; tools[] input_schema; tool RESULT → user tool_result block; tool_use → toolCalls) +
      `gemini.ts` (generateContent, key in the ?key= QUERY; system → systemInstruction; assistant→model;
      tools → [{functionDeclarations}]; tool RESULT → function-role functionResponse; functionCall → toolCalls).
      Both mirror the T3a dumb-transport contract, normalizing each provider's wire shape to the one
      `{text?, toolCalls?}`. Registry now resolves all four D1 types LIVE (the T3a placeholder for anthropic/
      gemini removed). GUARDS: `anthropic-gemini-llm.test.ts` (12 cases — request shape + auth + the wire
      mapping both ways + normalization + failure honesty) + the T3a registry test flipped (all 4 resolve live).
      Backend validate:local GREEN (2268 pass, +12).
- [x] **T4 — The bounded tool-calling orchestrator + `POST /api/v1/assistant/chat` (C537, commits 9363c00 +
      then route/mount + 7502805). Uses the RECOMMENDED D6 caps (K=5/T=4) + blocking D5 — confirm on T0.**
      `orchestrator.ts` runAssistant: the loop (design §4) — fixed system prompt + bounded history + the user
      message; each turn calls the dumb adapter; if toolCalls, runOneToolCall enforces the 3 ARCC guards per
      call [allowlist-check name → Zod-validate args → run under the SESSION userId], capped at K tool calls /
      T turns; exhaustion → an HONEST bounded reply (never fabricated). Read-only (no write tool). `assistant/
      routes.ts` mounted at /api/v1/assistant: requireAuth + a zValidator body with SAX-04 caps (message ≤2000,
      history ≤12 turns, only user/assistant roles from the client); resolve the enabled llm provider (none→400);
      {reply, toolsUsed}; PERSIST NOTHING; key never echoed; provider failure → 502 (the global rate-limiter
      already covers request-rate). GUARD `assistant-chat-route.test.ts` (10 cases, HTTP harness + a stateful
      scripted-fetch stub): clean round-trip; unknown-tool reject; bad-args Zod-reject; the K/T caps terminate a
      runaway loop with the honest reply; no-provider 400; provider 502; key not echoed; empty-message 400;
      unauth 401; the IDOR guard (a foreign vehicle never leaks). Refactored runOneToolCall out to keep the loop
      legible; a justified biome-ignore on the loop complexity (matches the restore/backup-orchestrator precedent).
      Backend validate:local GREEN (2278 pass, +10). **The ENTIRE BACKEND is now COMPLETE (T1–T4).**

## Phase 3 — frontend (eyes-on tail, R10 — live-LLM + Playwright-blocked → "code-complete, eyes-on pending")
- [x] **T5a — `assistant-api.ts` client (C538, commits f2d2dc8 + the feat).** `assistantApi.sendMessage(message,
      history) → { reply, toolsUsed }` over the shipped `POST /api/v1/assistant/chat`; AssistantTurn is
      user/assistant only (tool turns are server-produced). Mirrors the C514 vlm-api pattern; fork-free. GUARD
      `assistant-api.test.ts` (3 cases, mocked apiClient — endpoint + payload + the {reply,toolsUsed} envelope +
      history-defaults-[] + error propagation). FE validate:local GREEN (1426 vitest, +3). **The last fork-free
      slice — T5b/T6 below touch the gated forks (D1/D5), so the FE tail now waits on the T0 ruling.**
- [x] **T5b — The LLM-provider settings UI (C540, honors D1).** `LlmProvidersCard.svelte` on /settings:
      a clone of the eyes-on-verified `VlmProvidersCard` retargeted to `domain:'llm'` (Bot icon, assistant
      copy emphasizing READ-ONLY, `llm-*` testids) + a new `LLM_PROVIDER_TYPES` constant (the SAME 4
      D1 model types as VLM but with chat-model defaults — Ollama `llama3.1` not the VLM vision `llava`,
      since the assistant needs a TOOL-CALLING text model). Reuses `provider-api.ts` (createProvider with
      `domain:'llm'`, write-only apiKey, config-only PUT on edit). canSave mirrors the backend gate
      (name+model required; key required on non-ollama create, blank-keeps-key on edit; baseUrl when
      needed); four-states (loading/error/empty/data). Mounted on the settings page after the VLM card.
      Chose a CLONE over a domain-parameterized generalization: keeps this BUILD slice zero-regression on
      an eyes-on-verified surface; a DRY merge belongs in a later arch cycle with before/after shots.
      EYES-ON (boot + shot + Read): the Assistant card renders (empty state + Add Provider), the add dialog
      opens with the provider picker + name/model/baseUrl/key fields + the correctly-disabled save button,
      zero console errors. No card unit test (DueRemindersCard-class eyes-on convention, matches VLM T5b).
      FE validate:local GREEN (1426 vitest).
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
