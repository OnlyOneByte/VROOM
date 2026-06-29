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
- [ ] **T3 — The provider adapters** (D1 set; openai-compatible covers OpenAI + Ollama + gateways via
      baseUrl, plus anthropic + gemini as ruled). Each implements `VlmProvider.extractReceipt`: the
      provider-specific HTTP + auth header + the shared prompt. Unit-test each adapter's request shaping +
      response parsing against a MOCKED fetch (no live key). Honor the D2 self-hosted ruling (baseUrl).
- [ ] **T4 — `POST /api/v1/receipts/parse`** (design §4): multipart image → enabled-`vlm`-provider resolve
      (clear 400 if none) → server-side downscale + size cap (D5) → `getVlmProvider().extractReceipt` →
      strict-schema validate → return the DRAFT, PERSIST NOTHING. Errors honest: no-provider 400,
      provider failure 502 (the #43/#44 anti-fail-open). HTTP-harness test with a mocked provider: a good
      receipt → a clean draft; no provider → 400; provider throw → 502; an oversized image → rejected.

## Phase 3 — frontend (eyes-on tail, R9 — live-VLM + Playwright-blocked → "code-complete, eyes-on pending")
- [ ] **T5 — `vlm-api.ts` client + the settings provider UI.** `parseReceipt(image, vehicleId?)`; a VLM
      provider add/edit section in settings (type + apiKey write-only + model + baseUrl), mirroring the
      storage-provider UI. Type-check + a client unit test (the C149/C163 service-test pattern).
- [ ] **T6 — "Scan receipt" on `ExpenseForm`** (mobile-first `<input capture>`): pick → parse → pre-fill
      → review/edit → submit via the UNCHANGED create path → image attaches via the existing
      `expense_receipts` photo flow (R5). Four-states (loading/error-with-manual-fallback/empty/data) +
      the D3 confidence UX as ruled + the R7 first-use privacy disclosure. a11y + mobile, no overflow.
- [ ] **T7 — Round-trip e2e + DoD.** With a MOCKED vlm provider: pick-image → parse → assert the form
      pre-fills → submit → assert the expense row + the attached receipt photo (the FE→BE→draft→form→
      create seam, NORTH_STAR #3). The live-VLM leg stays eyes-on-pending. Feature-DoD: both sides
      validate:local green, the e2e green, eyes-on the scan flow (boot + shot.sh + Read the PNG), the
      privacy disclosure present. Tick the feature done.

## Notes
- **NO schema migration in v1** — `user_providers` is domain-agnostic; a `vlm` row needs no new column
  (the v2 design's whole point). D4 provenance, if later ruled in, is its own additive-migration spec.
- **The draft stays in DOLLARS** — the model reads dollars, the form sends dollars, cents convert ONLY at
  the existing create boundary (money-cents-migration). The parse route never touches cents.
- **The image persists only on confirm** — the parse route is stateless re: storage; R5 reuses the
  existing photo path so there is no second receipt-upload seam to maintain.
- WIP=1: finish this feature (or hand off the eyes-on tail) before starting the LLM-assistant spec
  (BACKLOG item 6). Recommend ordering receipt-parsing first (highest user-value, per the BACKLOG note).
