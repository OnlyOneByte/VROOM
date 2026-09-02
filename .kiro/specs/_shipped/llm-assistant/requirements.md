# LLM Assistant — Requirements

> DRAFT (2026-06-30). **Greenlit-to-spec** (Angelo, decision 23 of the 2026-06-29 batch: "all features
> are open to spec — mark all as greenlit to spec"). BACKLOG BUILD-QUEUE item 6 (TODO #12). Authored
> right after the VLM receipt-parsing feature shipped (C527) — this REUSES that feature's bring-your-own
> provider-domain architecture (a new `domain:'llm'` in `user_providers`), so the plumbing is a known
> quantity; the genuinely new surface is the conversational query over the user's car data.
>
> **Greenlit-to-spec is NOT a blank cheque on the product/UX forks inside.** SPEC authoring + the
> fork-free backend slices (the provider domain + the read-tool layer) are pre-authorized. The genuine
> forks (D1–D6 below) are surfaced for an Angelo ruling before the slice that depends on them builds —
> each has a RECOMMENDED option, so the default path can proceed if he ACKs.
>
> **ARCC-grounded (2026-06-30, queried BEFORE this design).** A natural-language assistant that answers
> questions over the user's financial/vehicle data via an external LLM touches: secrets management
> (SAX-03), PII egress to a third party (SAX-06), GenAI input validation + prompt injection (SAX-04),
> GenAI tool-use/agency (the "AI Request/Command/Query Forgery" class), the confused-deputy authorization
> trap, and per-user session isolation. Each maps to a concrete control in `design.md` §7.

## Problem
VROOM holds rich structured data — every expense, fill-up, fuel-efficiency trend, financing balance,
insurance term, maintenance reminder, per-vehicle TCO. Today the only way to interrogate it is to
navigate to the right analytics tab and read a chart. Many real questions are awkward to answer that
way: "how much did I spend on the truck last quarter?", "what is my Civic's average MPG this year vs
last?", "which vehicle costs me the most per mile?", "when is my next registration due?". A natural-
language assistant — bring-your-own LLM, exactly like the VLM provider — lets the user ASK and get a
grounded answer computed from their OWN data, instead of hunting through tabs.

## What VROOM is (constraints this feature MUST honor)
- **Privacy-first + self-hostable + bring-your-own provider** (NORTH_STAR). The user brings their OWN
  LLM provider + OWN API key (or a self-hosted local model via a base URL). VROOM never ships a shared/
  hosted key and never sends the user's data to a VROOM-operated endpoint. Self-hosting (Ollama) is the
  privacy-maximal path: with a local model, NO data leaves the host.
- **Data safety is sacred; correctness for everyone** (NORTH_STAR #1/#2). **v1 is READ-ONLY.** The
  assistant can READ the user's data to answer a question; it CANNOT create, edit, or delete anything.
  This is the single most important scope decision — it removes the entire write-side risk class
  (a model-driven bad write, the AI-query/command-injection + confused-deputy traps that ARCC flags for
  tool-use). A future spec can add gated, human-confirmed actions; v1 does not.
- **The model output is never trusted** (ARCC GenAI tool-use). Every tool the model may call is a FIXED,
  pre-specified, read-only function with Zod-validated typed parameters, scoped to the requesting user's
  own data through the EXISTING repositories — never raw SQL, never a parameter that widens access.

## Scope (v1)
**In:**
- A new provider **domain `llm`** in the existing `user_providers` system: the user adds an LLM provider
  (provider type + API key + model name + optional base URL). The API key is stored ENCRYPTED at rest via
  the existing `utils/encryption.ts` seam, identical to storage + vlm providers; NEVER returned to the FE.
- A backend **chat endpoint** that takes the user's message (+ short prior turns), runs a bounded
  tool-calling loop where the model may call a FIXED allowlist of READ-ONLY, userId-scoped data tools
  (e.g. `getExpenseSummary`, `getFuelStats`, `getVehicles`, `getUpcomingReminders`, `getFinancingState`),
  validates every tool call's arguments against a Zod schema, executes the tool through the existing
  repos under the SESSION user's id, feeds the result back, and returns the model's final grounded text.
- A frontend **assistant chat surface** (a route or panel): a message list + input, streaming or
  blocking, with loading / error / empty / data four-states + a one-time privacy disclosure.
- A strict **tool + turn budget** (max N tool calls + max M turns per request) so a runaway model loop
  cannot rack up the user's API cost or hammer the DB.

**Out (deferred — name them so scope is honest):**
- **Any write/action capability** (creating an expense, editing a reminder, deleting data) — v1 is
  read-only Q&A. A "let the assistant DO things" feature is a SEPARATE, gated, human-confirm spec.
- A VROOM-hosted/shared LLM key or any VROOM-operated inference endpoint (violates bring-your-own).
- Cross-user / fleet-wide assistant; multi-user shared conversations.
- Retrieval over free-text documents / RAG over uploaded files (v1 answers from STRUCTURED data via
  typed tools, not a vector store).
- Long-term conversation memory / training on the user's data (the model is called statelessly per
  request with only the current short transcript; nothing is used for training — ARCC training-data
  guidance is N/A because we never train/fine-tune).
- Voice input/output.

## Decisions to surface (the genuine product/UX forks — each greenlit-to-spec but ruled before its slice)
- **D1 — Which LLM providers in v1?** RECOMMEND mirror the VLM D1 set: an **OpenAI-compatible** type (one
  adapter covers OpenAI + the many OpenAI-API gateways + Ollama via base URL), **Anthropic** (Claude),
  **Google Gemini**, and **Ollama / self-hosted** (privacy-maximal). All four must support tool/function
  calling (they do). Rationale: identical to the shipped VLM adapter set — maximal reuse, ~3 adapters.
  (Alternative: OpenAI-compatible only in v1.)
- **D2 — Read-only in v1, or allow gated actions?** RECOMMEND **read-only, hard** (see Scope). The
  assistant answers questions; it never writes. This is the safest v1 and the cleanest answer to the
  ARCC tool-use/confused-deputy guidance. (Alternative: add a few human-confirmed write actions now —
  much larger UX + safety surface; recommend a later spec.)
- **D3 — Conversation history: persisted or ephemeral?** RECOMMEND **ephemeral in v1** — the transcript
  lives in the client for the session; the backend is stateless (each request carries the recent turns
  the client sends, bounded). No new `conversations` table, no backup/restore surface, no cross-device
  sync, and per-ARCC session-isolation is trivially satisfied (there is no stored history to leak).
  (Alternative: persist history server-side for cross-device continuity — a new userId-scoped table +
  backup round-trip + a retention/delete control; defer.)
- **D4 — Which data tools does the model get (the allowlist)?** RECOMMEND a small, high-value, READ-ONLY
  set wrapping EXISTING analytics/repo seams: `listVehicles`, `getExpenseSummary(range, vehicleId?)`,
  `getFuelStats(range, vehicleId?)`, `getCostPerMile(vehicleId?)`, `getUpcomingReminders`,
  `getFinancingState(vehicleId)`, `getInsuranceState(vehicleId)`. Every tool is userId-scoped via the
  existing repositories (no new query path). Start minimal; add tools in later slices. (Fork: the exact
  tool list + whether to expose raw expense rows vs only aggregates — RECOMMEND aggregates/summaries
  first, not raw-row dumps, for data-minimization.)
- **D5 — Streaming or blocking responses?** RECOMMEND **blocking in v1** (simpler: one request → the
  final answer, with a spinner), with streaming (SSE) as a fast-follow. Blocking keeps the tool-loop
  server-side and the FE simple; streaming is a UX nicety, not a correctness requirement. (Alternative:
  SSE streaming now — more FE/BE plumbing.)
- **D6 — Cost/abuse guardrail.** RECOMMEND: a hard cap of **≤K tool calls and ≤T model turns per chat
  request** + the existing rate-limit + a bounded max input length (ARCC SAX-04 input-length cap) + a
  bounded transcript window. The cost lands on the USER's own key (not multi-tenant), so the guardrail
  is about runaway loops + oversized prompts, not fairness. Confirm K/T (recommend K=5 tool calls, T=4
  model round-trips).

## Functional requirements
- **R1 — Add an LLM provider.** The user creates a `domain:'llm'` provider with a `providerType` (D1
  set), an API key (→ encrypted credential), a model name, and an optional base URL. Reuses the EXISTING
  `POST /api/v1/providers` generic CRUD + the per-type validation registry (the exact `validateVlmProviderConfig`
  pattern, generalized). The key is stripped from every response (`formatProviderResponse`).
- **R2 — Chat → grounded answer.** `POST` `{ message, history? }` → the backend resolves the user's
  enabled `llm` provider, runs the bounded tool-calling loop (R3), and returns `{ reply, toolsUsed[] }`.
  PERSISTS NOTHING (D3 ephemeral). No `llm` provider configured → a clear actionable error (link to add).
- **R3 — Tool-use discipline (the load-bearing safety rule; ARCC GenAI-tool-use + SAX-04).** The model is
  offered a FIXED allowlist of READ-ONLY tools (D4). On each model tool-call: (a) the tool name MUST be in
  the allowlist (else rejected); (b) the arguments are parsed through that tool's STRICT Zod schema
  (typed, bounded, allow-listed enums) BEFORE execution — never a raw string into a query; (c) the tool
  runs through the EXISTING repository under the SESSION user's id (userId-scoped — the model cannot
  supply a userId or widen scope: the confused-deputy guard); (d) the loop is hard-capped at K tool calls
  / T turns (D6). The model's free-text output is treated as untrusted and is NEVER used for any
  authorization or security decision.
- **R4 — No writes in v1 (NORTH_STAR #1).** No tool in the allowlist mutates data. The assistant cannot
  create/edit/delete an expense, reminder, vehicle, or provider. (A future gated-action spec would add
  human-confirmed writes; v1 has none — so there is no model-driven write path to secure.)
- **R5 — Authorization is never delegated to the model (ARCC confused-deputy).** Every tool executes with
  the authenticated session user's id from the request context — NOT a userId the model produced. A tool
  can only ever read the requesting user's own rows; there is no parameter by which the model could reach
  another user's data. (Single-user-deployment-friendly AND multi-tenant-safe, mirroring the IDOR
  discipline from vehicle-sharing.)
- **R6 — Credentials at rest (SAX-03).** The LLM API key is encrypted at rest (AES-256-GCM via
  `utils/encryption.ts`, the `PROVIDER_ENCRYPTION_KEY` seam), never logged, never returned to the client.
  Fail-closed on a missing/invalid key — identical to storage + vlm providers.
- **R7 — PII to a third party (SAX-06) + data minimization.** Only the data needed to answer the question
  is sent to the provider: the user's message, the bounded recent transcript, the tool definitions, and
  the tool RESULTS the model requested (which are the user's own aggregates). No other VROOM user's data;
  no raw bulk dump beyond what a called tool returns; TLS to the provider; NO server-side retention of the
  message or response beyond the request (D3 ephemeral). A one-time disclosure states what chatting sends
  and to whom, plus the self-hosted (no-data-leaves-host) option. The user brings their own provider/key
  (the user is the data controller — VROOM's bring-your-own privacy model).
- **R8 — Untrusted-output handling (ARCC do-not-trust-output + SAX-04).** The model's final text is
  rendered as plain text / safe markdown (no HTML injection, no executing anything it returns); any tool
  arguments are validated (R3); the reply is never fed into another system or a security decision. A
  provider/network failure surfaces HONESTLY as an error with a retry/manual fallback — never a faked or
  hallucinated "success" (the #43/#44/#144 anti-fail-open lesson).
- **R9 — Data safety / backup.** An `llm` provider row round-trips through backup/restore like every other
  `user_providers` row (already a covered table). NO new table in v1 (D3 ephemeral history), so
  `validateReferentialIntegrity` is unchanged. If D3 later rules "persist history," that becomes its own
  additive-migration slice with a userId-scoped table + a backup round-trip guard + a delete control.
- **R10 — UI (eyes-on tail, NORTH_STAR #3).** An LLM-provider add/edit surface in settings (api key +
  model + base URL; key write-only) — reuses the VLM provider-card pattern. An assistant chat surface
  (message list + input + four-states + a first-use privacy disclosure). Then the FE→BE→tool-loop→reply
  e2e with a MOCKED provider (the live LLM call is harness-blocked) exercising the full seam; the
  live-LLM leg stays eyes-on-pending.

## Non-goals / guardrails
- VROOM NEVER operates inference or holds a shared key — bring-your-own only (NORTH_STAR privacy-first).
- The assistant is READ-ONLY in v1 — it never writes data; there is no model-driven mutation to secure.
- Authorization is NEVER derived from model output — every tool runs userId-scoped via the session
  context (ARCC confused-deputy).
- No tool gives the model raw SQL, a shell, a URL fetcher, or any network/file primitive — the allowlist
  is a fixed set of typed read-only repo calls (ARCC AIRF/AICi/AIQi).
- No training/fine-tuning on the user's data; the model is called statelessly per request.
- No logging of the API key, the user's message, the tool results, or the model response body.
