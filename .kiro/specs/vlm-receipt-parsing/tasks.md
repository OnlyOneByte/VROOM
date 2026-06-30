# VLM Receipt Parsing — Tasks

> Backend-first per CLAUDE.md (config/provider-domain → strategy registry → parse route/validation →
> frontend eyes-on tail), exactly like trips / recurring / import / vehicle-sharing. **The SPEC is
> greenlit-to-spec (Angelo decision 23, 2026-06-29).** The fork-free backend slices (T1–T2) are
> pre-authorized; **T0 is a SIGN-OFF GATE for the D1–D5 product/UX forks** in `requirements.md` — the
> slices that depend on a fork (the D1 adapter set, D2 self-hosted, D3 confidence UX, D4 provenance, D5
> caps) wait on its ruling. One task per `feature` cycle, each independently verified via
> `bun run validate:local` both sides; never commit red.
>
> KEY GROUNDING (do not re-derive): a VLM is a NEW PROVIDER DOMAIN (`domain:'vlm'`) in the EXISTING
> `user_providers` system — encrypted bring-your-own credentials via `utils/encryption.ts`, a per-type
> strategy registry mirroring `domains/storage/registry.ts`, secrets stripped from responses. **NO schema
> migration in v1** (`user_providers` is domain-agnostic). The parse route returns a DRAFT and PERSISTS
> NOTHING; the user confirms through the UNCHANGED `POST /expenses` create path; the image attaches via
> the EXISTING `expense_receipts` photo flow. The model's output is UNTRUSTED — strict Zod, fail-closed,
> never auto-written (design §4/§7.3).

## Phase 0 — sign-off (gates the fork-dependent slices)
- [ ] **T0 — Angelo rules D1–D5** (`requirements.md`). Each has a RECOMMENDED option; an "ACK" takes the
      recommendation. D1 adapter set (recommend openai-compatible + anthropic + gemini + ollama), D2
      self-hosted-in-v1 (recommend yes), D3 low-confidence UX (recommend simple pre-fill, no per-field
      flags), D4 provenance tag (recommend defer — no `expenses` schema change in v1), D5 cost/size cap
      (recommend reuse rate-limit + body-limit + an image-size cap + server-side downscale; confirm the
      cap, e.g. ≤8 MB). **T1–T2 below do NOT depend on T0 and may build first** (the provider-domain
      plumbing is fork-free); T3+ adapters/route honor the D1/D2/D5 ruling.

## Phase 1 — the VLM provider domain (fork-free; encrypted bring-your-own credential plumbing)
- [x] **T1 — `vlm`-domain provider validation + CRUD wiring (C509, commit 991b88f).** Extended
      `providers/routes.ts`: `SUPPORTED_PROVIDER_TYPES` + the 4 `VLM_PROVIDER_TYPES`
      (openai-compatible/anthropic/gemini/ollama) + an `isVlmProviderType` guard;
      `validateVlmProviderConfig` SPLIT into `validateVlmConfigShape` + `validateVlmCredentials` (so each
      path validates only the field it touches), wired into BOTH `resolveProviderCredentials` (create) AND
      the PUT handler (the #123 both-paths discipline): model required always, apiKey required for
      non-ollama, baseUrl required for ollama/openai-compatible; a config-only PUT does NOT demand the key
      (already stored encrypted). + a POST domain↔type consistency guard (a vlm type ⇒ domain:'vlm' and
      vice-versa). GUARD `vlm-provider-config.test.ts` (12 cases, createTestApp): api key ENCRYPTED in the
      raw row + STRIPPED from the response; missing model/key/baseUrl 400 at create AND PUT; config-only
      PUT keeps the key; ollama-keyless allowed; domain↔type mismatch 400. Reactive fix folded: deleted the
      dead async `insertJunctionRows` (orphaned by the C504 sync conversion, a latent biome error the
      whole-tree check flagged). Backend validate:local GREEN (2146 pass, +10).
- [x] **T2 — The strategy registry + the fixed extraction prompt/schema (C510, commit e56eebd).**
      `domains/vlm/`: `vlm-provider.ts` (the `VlmProvider` interface — adapters are dumb transport),
      `prompt.ts` (the FIXED `RECEIPT_EXTRACTION_PROMPT` + the STRICT `receiptExtractionSchema` +
      `parseExtraction`, the fail-closed boundary: every field independently bounded, bad fields DROPPED
      via per-field salvage, unparseable → empty draft no-throw, unknown keys stripped, money in DOLLARS),
      and `registry.ts` (`getVlmProvider(row)` decrypt → switch → throw on unknown; `resolveVlmSettings`
      defense-in-depth re-validate; adapter builders wired + throwing a clear T3-placeholder). **Guard:**
      `vlm-extraction-schema.test.ts` (22 cases): clean/partial/string/fenced map correctly; negative/zero/
      NaN/Infinity amount, out-of-set/wrong-case category, malformed date, bad odometer, empty/over-long
      vendor all DROPPED; one bad field does not nuke the good; injection/garbage → empty draft no-throw;
      registry decrypt+dispatch+unknown-throw. Backend validate:local GREEN (2168 pass, +22).

## Phase 2 — the parse route (honors the D1/D2/D5 ruling)
- [x] **T3a — The OpenAI-compatible adapter (C511, commit 1f2ac97) — FORK-FREE.** `openai-compatible.ts`:
      `OpenAiCompatibleVlmProvider.extractReceipt` → POST `{baseUrl}/chat/completions` with an image_url
      data-URL part + the FIXED prompt; dumb transport (returns raw text; parseExtraction validates);
      temperature 0 + token cap + 30s timeout; Bearer header present-with-key / OMITTED-for-keyless-ollama;
      non-2xx/network/timeout THROWS (route→502, anti-fail-open); no-content/malformed-JSON → empty string.
      registry routes BOTH openai-compatible AND ollama here (Ollama speaks the same shape, design §3).
      GUARD `openai-compatible.test.ts` (12 cases, stubbed fetch). Built ahead of the T0 ruling because
      openai-compatible is the COMMON DENOMINATOR of every D1 option → zero rework risk. Green (2179 pass).
- [x] **T3b — The Anthropic + Gemini adapters (C515, commit 2ab2e88).** D1 ruled the full set (Angelo ACK
      2026-06-30: OpenAI-compatible + Anthropic + Gemini + Ollama). `anthropic.ts` (AnthropicVlmProvider:
      POST /v1/messages, x-api-key + anthropic-version, base64 image source block) + `gemini.ts`
      (GeminiVlmProvider: generateContent, ?key= query param, inline_data part). Both mirror the T3a DUMB-
      transport contract (fixed prompt, raw text out, parseExtraction is the sole validator, non-2xx/network
      THROWS → 502, missing content → '', temp 0 + token cap, key never logged). registry builders return the
      live adapters. GUARDS: anthropic.test.ts + gemini.test.ts (stubbed fetch — request shape + auth + failure
      honesty); registry test updated (all 4 D1 types resolve live). Backend validate:local GREEN (2202 pass, +23).
- [x] **T4 — `POST /api/v1/receipts/parse` (C512, commit b85eb13) — structurally FORK-FREE.** `vlm-routes.ts`
      mounted at `/api/v1/receipts`: multipart image → resolve the enabled `vlm` provider (none → actionable
      400) → image-type (jpeg/png/webp) + 8MB cap (bodyLimit + post-parse byte check) → `getVlmProvider()
      .extractReceipt` → `parseExtraction` (fail-closed) → return `{ draft }`, PERSIST NOTHING. Errors honest:
      no-provider 400, provider failure 502 (anti-fail-open), api key never echoed. Used the recommended D5
      8MB cap (a tunable const). Server-side downscale is a noted follow-on (needs an image lib; not a
      correctness gate). GUARD `vlm-parse-route.test.ts` (9 cases, real HTTP harness, adapter fetch stubbed):
      clean draft + zero rows persisted; fail-closed drop; empty draft; no-provider 400; provider 502; wrong
      type 400; missing file 400; key not echoed; unauth 401. Green (2187 pass).

## Phase 3 — frontend (eyes-on tail, R9 — live-VLM + Playwright-blocked → "code-complete, eyes-on pending")
- [x] **T5a — `vlm-api.ts` client (C514, commit 3a3679f) — FORK-FREE.** `vlmApi.parseReceipt(image: File)`
      uploads multipart to the shipped `POST /api/v1/receipts/parse`, unwraps `{ draft }`, returns a
      `ReceiptDraft` (all fields optional; category ∈ the 6 ExpenseCategory; dollars, never auto-written).
      Mirrors `expense-api.uploadPhoto`. GUARD `vlm-api.test.ts` (3 cases, mocked apiClient): endpoint +
      multipart payload + `{draft}` unwrap + empty-draft + error propagation. FE validate:local GREEN (1332
      vitest pass, +3); prettier + eslint clean. Built ahead of the ruling — a thin wrapper over the
      contract-fixed route, independent of D1/D3/D4/D5.
- [x] **T5b — The VLM-provider settings UI (C525, commit 8c3cf21).** `VlmProvidersCard.svelte` (mounted on
      /settings after Storage Providers) + an inline add/edit Dialog; `VLM_PROVIDER_TYPES` constant = the D1 set
      (openai-compatible + anthropic + gemini + ollama, per-type keyless/needsBaseUrl + default model/baseUrl).
      Reuses `provider-api.ts` getProviders('vlm')/create/update/delete. API key is WRITE-ONLY (never pre-filled;
      blank-on-edit keeps the stored key → config-only PUT). canSave mirrors the backend gate. Four-states +
      privacy line. EYES-ON DONE: booted servers, seeded openai-compatible + ollama providers via the real authed
      POST (both 201, credentials stripped), shot /settings desktop — card renders populated + edit/delete, zero
      console errors. FE validate:local GREEN (1332 vitest); prettier+eslint clean.
- [x] **T6 — "Scan receipt" on `ExpenseForm` (C526, commit bc83d05).** ReceiptScanButton.svelte (mobile-first
      hidden `<input accept=image/* capture=environment>`) wired into ExpenseForm top, create-mode only.
      pick → vlmApi.parseReceipt → handleReceiptDraft pre-fills (amount dollar-string / date YYYY-MM-DD /
      odometer→mileage / vendor→description-if-empty / category via selectCategory so side-effects fire);
      image rides pendingFiles → existing expense_receipts flow on save (R5); user submits the UNCHANGED path.
      Four-states (idle/loading/error+Try-again fallback/data); D3 ruled-simple (no per-field confidence); R7
      one-time privacy AlertDialog (localStorage-remembered); ApiError.statusCode → 400 no-provider / 502
      unreachable messaging. EYES-ON DONE: Playwright drive (stubbed parse) — disclosure shown, then
      amount=$47.83 / date=Mar 12 2026 / mileage=84231 / category=Fuel (fuel-details expanded) /
      description=Shell Station all pre-filled + image queued; zero console errors. FE validate:local GREEN
      (1332 vitest); prettier+eslint clean.
- [x] **T7 — Round-trip e2e + DoD (C527).** Two artifacts. (1) DURABLE committed guard
      `backend/src/api/providers/__tests__/vlm-receipt-roundtrip.test.ts` (3 cases, createTestApp + the
      adapter fetch STUBBED = the mocked VLM): parse → take the draft → map it as the form does
      (handleReceiptDraft + handleSubmit + toBackendExpense) → POST /expenses → GET it back; pins the
      money seam (47.83 dollars→cents→dollars EXACT), odometer→mileage, vendor→description-if-empty,
      category; re-asserts parse persists NOTHING; partial-draft + vendor-does-not-clobber-typed-desc
      cases. This is the merge-surviving half (source-scan-guard discipline). (2) EYES-ON untracked e2e
      `frontend/e2e/vlm-receipt-roundtrip.meshclaw.e2e.ts` (gitignored): the FULL UI seam with the live
      VLM leg MOCKED via page.route, the photo leg via the fake-storage seam — scan → disclosure
      (pre-ack) → upload → assert prefill (#amount 47.83 / #mileage 84231 / #description Shell Station /
      category Fuel / queued image) → user adds volume → confirm via the UNCHANGED create path → assert
      the expense row persisted (expenseAmount 47.83 / mileage 84231 / category fuel) AND the receipt
      PHOTO attached (R5, the expense_receipts flow). EYES-ON: booted servers (ALLOW_FAKE_STORAGE=1),
      drove the scan flow, shot + Read the PNG — every field pre-filled, image queued, "Receipt scanned"
      toast, ZERO console errors. Both sides validate:local GREEN (BE 2205 pass [+3], FE 1332 vitest).
      **The VLM receipt-parsing feature is DONE.**

## Notes
- **NO schema migration in v1** — `user_providers` is domain-agnostic; a `vlm` row needs no new column
  (the v2 design's whole point). D4 provenance, if later ruled in, is its own additive-migration spec.
- **The draft stays in DOLLARS** — the model reads dollars, the form sends dollars, cents convert ONLY at
  the existing create boundary (money-cents-migration). The parse route never touches cents.
- **The image persists only on confirm** — the parse route is stateless re: storage; R5 reuses the
  existing photo path so there is no second receipt-upload seam to maintain.
- WIP=1: finish this feature (or hand off the eyes-on tail) before starting the LLM-assistant spec
  (BACKLOG item 6). Recommend ordering receipt-parsing first (highest user-value, per the BACKLOG note).
