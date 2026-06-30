# VLM Receipt Parsing — Design

> DRAFT (2026-06-29), paired with `requirements.md`. Backend-first per CLAUDE.md
> (config/provider-abstraction → route/validation → frontend eyes-on tail). **Nothing that depends on a
> product fork (D1–D5) builds until Angelo rules it;** the SPEC + the fork-free backend slices are
> greenlit-to-spec (decision 23).
>
> Grounded against the live code (2026-06-29):
> - `backend/src/utils/encryption.ts` — AES-256-GCM `encrypt()`/`decrypt()`, key from
>   `PROVIDER_ENCRYPTION_KEY` (64-hex/32-byte, validated in `config.ts`).
> - `backend/src/db/schema.ts` — `user_providers` is **domain-agnostic** (`domain` + `providerType` +
>   encrypted `credentials` + json `config`); UNCHANGED in v2. A new `domain:'vlm'` needs NO schema change.
> - `backend/src/api/providers/routes.ts` — generic provider CRUD; `resolveProviderCredentials` encrypts on
>   create, `formatProviderResponse` strips secrets, `validateStorageProviderConfig` is the per-type gate
>   pattern to mirror for `vlm`.
> - `backend/src/api/providers/domains/storage/registry.ts` — the provider STRATEGY pattern
>   (`getProvider` decrypts creds + switches on `providerType` → a typed provider instance). The `vlm`
>   domain mirrors this with its own registry.
> - `backend/src/api/expenses/routes.ts` — `createExpenseSchema` (the draft must map onto these fields);
>   `EXPENSE_CATEGORIES` = `['fuel','maintenance','financial','regulatory','enhancement','misc']`.
> - `backend/src/api/providers/routes.ts:23` — `expense_receipts: ['expense']` is the existing receipt
>   photo category the confirmed-expense image reuses (R5).

## §0 — The one-line architecture
A VLM is a new PROVIDER DOMAIN (`vlm`) in the SAME `user_providers` system the storage providers use —
encrypted bring-your-own credentials, a per-type strategy registry, secrets stripped from responses. The
parse route resolves the user's `vlm` provider, calls it with a strict extraction prompt, validates the
JSON response into a bounded DRAFT, and returns it. The frontend pre-fills the EXISTING expense form with
the draft; the user confirms through the UNCHANGED create path. **No new table in v1.** No auto-write.

## §1 — Config + the VLM provider domain (no schema migration)
`user_providers.domain` is already free-text (`'storage'` today). A VLM provider is a row with
`domain:'vlm'`, a `providerType` from the D1 set, encrypted `credentials = { apiKey }`, and
`config = { model, baseUrl? }`. **Zero schema change** — this is exactly why the v2 design left
`user_providers` domain-agnostic.

```ts
// the row shape (existing columns, new domain value):
// { domain: 'vlm', providerType: 'openai-compatible'|'anthropic'|'gemini'|'ollama',
//   credentials: encrypt(JSON.stringify({ apiKey })),   // ollama may have an empty/placeholder key
//   config: { model: 'gpt-4o-mini'|'claude-3-5-sonnet'|'gemini-1.5-flash'|..., baseUrl?: string } }
```
- The api key is the ONLY secret; it rides `credentials` (encrypted) exactly like a storage refreshToken.
- `model` + `baseUrl` are non-secret → `config` (json), like a storage folderPath. `baseUrl` enables
  self-hosted (Ollama) + any OpenAI-compatible gateway (D2).

## §2 — Provider validation (mirror `validateStorageProviderConfig`)
Add a `vlm`-domain branch to the create/update validation so a broken VLM row can never persist (the
#103/#123 fail-fast-at-create discipline):
```ts
// providers/routes.ts — extend resolveProviderCredentials / a new validateVlmProviderConfig
function validateVlmProviderConfig(providerType: string, config, credentials): void {
  // every vlm type needs a model; non-ollama needs an apiKey; ollama/openai-compatible needs a baseUrl
  if (!config?.model) throw new ValidationError('VLM config must include a model name');
  if (providerType !== 'ollama' && !credentials?.apiKey)
    throw new ValidationError('VLM provider requires an API key');
  if ((providerType === 'ollama' || providerType === 'openai-compatible') && !config?.baseUrl)
    throw new ValidationError('Self-hosted/compatible VLM requires a base URL');
}
```
The generic `POST/PUT /api/v1/providers` flow is otherwise UNCHANGED: it already encrypts `credentials`,
strips them from the response, and is userId-scoped + tenant-safe (the C233/#80 + #123 work).

## §3 — The VLM strategy registry (`api/providers/domains/vlm/`, new — mirrors storage/)
```
domains/vlm/
  vlm-provider.ts        // interface VlmProvider { extractReceipt(image: Buffer, mime: string): Promise<RawExtraction> }
  openai-compatible.ts   // OpenAI /v1/chat/completions vision (covers OpenAI + Ollama + gateways via baseUrl)
  anthropic.ts           // Claude messages vision
  gemini.ts              // Gemini generateContent vision
  registry.ts            // getVlmProvider(row): decrypt creds + switch on providerType → VlmProvider
  prompt.ts              // the FIXED structured-extraction prompt + the response Zod schema
```
- `getVlmProvider` mirrors `storage/registry.ts:getProvider` EXACTLY: short-circuit nothing, decrypt
  `row.credentials`, `JSON.parse`, switch on `row.providerType`, throw `ValidationError` on an unknown
  type. One typed interface; one adapter per provider type.
- Each adapter sends `{ image (base64/data-url, downscaled), the fixed prompt }` and returns the model's
  RAW text/JSON. The adapter does the provider-specific HTTP + auth header (Bearer apiKey / x-api-key /
  ?key=); the SHARED `prompt.ts` owns the extraction instruction + the validation so behavior is
  identical across providers.

## §4 — The parse route (`POST /api/v1/receipts/parse` — new, or `/api/v1/vlm/parse`)
```
multipart/form-data: { image: File, vehicleId?: string }
  → auth (existing requireUser middleware)
  → body-size + rate-limit middleware (existing, D5)
  → load the user's enabled domain:'vlm' provider (404/clear error if none)
  → downscale + re-encode the image server-side (sharp/jimp or a bounded resize) — data-min + cost
  → getVlmProvider(row).extractReceipt(buf, mime)
  → parse the model output through prompt.ts's STRICT Zod schema (R3, fail-closed)
  → map to a DRAFT (dollars at the edge — the model reads dollars; the form sends dollars; cents convert
    only at the existing create boundary, so the draft stays in DOLLARS)
  → return { draft: { amount?, date?, odometer?, category?, vendor?, vehicleHint?, rawText? } }
  → PERSIST NOTHING
```
- Errors: no provider → 400 with an actionable message; provider HTTP/timeout → 502 (surface honestly,
  the #43/#44/#144 fail-open lesson — never fake a success); validation drops bad fields silently into an
  omitted draft field (the user fills it).
- The draft `category` is constrained to the 6 `EXPENSE_CATEGORIES` IN the schema — an out-of-set guess
  is dropped, not passed through (R3).

## §5 — Frontend (eyes-on tail, R9 — Playwright/live-VLM-blocked → "code-complete, eyes-on pending")
- `vlm-api.ts` client (the C149/C163 service pattern): `parseReceipt(image, vehicleId?) → Draft`;
  provider CRUD reuses the existing `providerApi`.
- A VLM-provider section in settings (add/edit: type + apiKey [write-only] + model + baseUrl), mirroring
  the storage-provider UI. The key field is never populated from the server (write-only, R6).
- A **"Scan receipt"** button on `ExpenseForm` (mobile-first `<input capture>`): pick photo → spinner →
  parse → pre-fill the form fields from the draft → user reviews/edits → submit via the UNCHANGED create
  path → the image attaches via the existing `expense_receipts` photo flow (R5). Four-states: loading
  (parsing), error (parse failed — "fill manually" fallback, form never blocked), empty (no draft fields
  read), data (pre-filled).
- A one-time privacy disclosure (R7): "Scanning sends this photo to <provider>. For maximum privacy, use
  a self-hosted model." Dismissible; surfaced before the first scan.
- e2e: with a MOCKED vlm provider (the live call needs a real key/host — harness-blocked), drive
  pick-image → parse → assert the form pre-fills → submit → assert the expense row + the receipt photo.
  This exercises the full FE→BE→draft→form→create seam (NORTH_STAR #3 integrated-round-trip rule); the
  live-VLM leg stays eyes-on-pending.

## §6 — Backup / restore / sync (R8, NORTH_STAR #1)
- A `vlm` provider is a `user_providers` row → ALREADY covered by the provider backup/restore + the
  table-coverage guards. NO new table in v1 (D4 defers provenance), so `validateReferentialIntegrity` is
  unchanged. The encrypted api key round-trips as the credential blob does for storage providers.
- If D4 later rules "tag receipt-sourced expenses," that is a separate additive-migration slice (a
  `sourceType:'receipt'` enum value + the both-or-neither refine extension + a round-trip guard) — NOT
  in v1.

## §7 — ARCC governance mapping (queried 2026-06-29 BEFORE this design; the citation-by-citation grounding)
The feature sends user data (a receipt image) to an external third party using a stored credential and
feeds untrusted content (the image) to an LLM. Three ARCC domains fired; each maps to a concrete control:

1. **SAX-03 — Third-party integration & customer-owned secrets / secrets management.** ARCC guidance:
   never store secrets in code/config; encrypt at rest (AES-256 min); keep secrets separate from code;
   validate all third-party responses; fail-closed. → **Control:** the api key reuses the EXISTING
   `utils/encryption.ts` AES-256-GCM seam + the `PROVIDER_ENCRYPTION_KEY` env (validated 64-hex in
   `config.ts`), stored in `user_providers.credentials` (encrypted), stripped from every response
   (`formatProviderResponse`), never logged. This is the SAME control already shipped + audited for
   storage providers — no new crypto, no plaintext key. (The AWS-Secrets-Manager/KMS specifics in the
   doc are the AWS-hosted instantiation; for a self-hostable single-user PWA, "encrypted at rest with a
   dedicated key, separate from code, AES-256" is the portable requirement, and `encryption.ts` meets it.)
2. **SAX-06 — PII & third-party data handling.** ARCC guidance: data minimization, encryption in transit
   (TLS 1.2+), clear retention policy with deletion of temporary copies, transparency. → **Control:** the
   parse request sends ONLY the image + the fixed prompt (no other user data); TLS to the provider;
   NO server-side retention of the raw response (in-memory draft only — the image persists ONLY on user
   confirm, via the existing photo path); the user brings their OWN provider/key (the user is the data
   controller, consistent with VROOM's bring-your-own privacy model); a first-use disclosure + the
   self-hosted (no-data-leaves-host) option for the privacy-maximal user.
3. **Bedrock LLM guardrails — prompt injection & untrusted output.** ARCC guidance: a receipt image is
   untrusted input vulnerable to prompt injection; the model's output must be filtered/validated before
   use; never feed unvalidated model output downstream. → **Control:** the extraction prompt is FIXED and
   instructs structured extraction only; the response is parsed through a STRICT Zod schema with every
   field bounded (positive amount, real date, category ∈ the 6-value enum, non-negative odometer);
   anything failing is DROPPED (fail-closed), never coerced; and CRUCIALLY the validated draft is NEVER
   auto-written — it pre-fills a form the human confirms, and the create path re-validates server-side
   (R3/R4). Instructions embedded in a receipt image cannot escalate beyond "extract to the fixed schema."

## §8 — Risk register
1. **Untrusted model output → silent bad write.** Mitigation: R3 fail-closed validation + R4 human
   confirm + the unchanged server-side create validation. The model never writes; it suggests.
2. **API key leak.** Mitigation: encrypted at rest (R6), write-only in the UI, stripped from responses,
   never logged — the audited storage-provider discipline.
3. **PII to a third party.** Mitigation: bring-your-own provider/key + data-minimized request + no
   retention + disclosure + the self-hosted option (R7/§7.2).
4. **Cost/abuse runaway.** Mitigation: the existing rate-limit + body-size middleware + an image-size cap
   + server-side downscale (D5). The cost lands on the user's own key (not multi-tenant).
5. **Fail-open dishonesty** (the #43/#44/#144 class). Mitigation: a provider/network failure surfaces as
   a 502 + a clear FE error with a manual-entry fallback — never a faked success or a blank silent draft.
6. **The C151 async-tx footgun** — N/A in v1 (the parse route persists nothing; the confirm goes through
   the existing single-write create path). If D4 adds provenance later, that slice follows the sync-tx
   discipline.
