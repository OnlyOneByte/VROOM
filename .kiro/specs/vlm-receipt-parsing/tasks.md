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
- [ ] **T1 — `vlm`-domain provider validation + CRUD wiring.** Extend `providers/routes.ts` with a
      `validateVlmProviderConfig` (mirror `validateStorageProviderConfig`, design §2): a `vlm` row requires
      a `config.model`; a non-ollama type requires `credentials.apiKey`; a self-hosted/compatible type
      requires `config.baseUrl`. Wire it into `resolveProviderCredentials` (create) + the PUT handler
      (the #123 both-paths discipline). The generic CRUD already encrypts + strips secrets + is
      tenant-scoped — assert that via the existing HTTP harness. **Guard:** a `vlm-provider-config.test.ts`
      (createTestApp): a `vlm` provider with a key persists with credentials ENCRYPTED (not plaintext in
      the row) + the GET response STRIPS the key; an incomplete config (no model / no key on a key-required
      type) 400s at create AND at PUT. Backend validate:local green.
- [ ] **T2 — The strategy registry + the fixed extraction prompt/schema** (`domains/vlm/`, design §3).
      `vlm-provider.ts` (the `VlmProvider` interface), `registry.ts` (`getVlmProvider(row)`: decrypt →
      switch on providerType → throw on unknown, mirroring `storage/registry.ts`), and `prompt.ts` (the
      FIXED extraction instruction + the STRICT response Zod schema: bounded amount/date/category∈the-6/
      odometer, fail-closed). **Guard:** a `vlm-extraction-schema.test.ts` — a well-formed model JSON maps
      to a clean draft; a malformed/out-of-range/injection-y response (negative amount, bogus category,
      embedded "ignore previous instructions") DROPS the bad fields (fail-closed) and never throws into a
      write. NO live HTTP yet (the adapters' network calls land in T3). Backend validate:local green.

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
