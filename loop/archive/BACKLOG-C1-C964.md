# BACKLOG — VROOM autonomous loop

> **Fresh reset 2026-06-26 (post-C350).** Only OPEN work is below. The full pre-reset queue (371+ done
> items, all grounding) is in `loop/archive/BACKLOG-C1-C350.md` (+ `-C1-C467`) — consult it for "was X
> already done / certified clean / what was the grounding for #N?" before re-doing work. Read `GUIDE.md`
> first (MODE → BUILD QUEUE → velocity rules → META-LOOP), then NORTH_STAR, then this file.

## How to pick (mirrors GUIDE)
- **BUILD MODE** (an unblocked build item exists — it does): pop the next slice of the in-flight BUILD
  QUEUE item below. WIP=1 — finish one feature before starting another. Maintenance fires only
  reactively (a real bug found while building) or on the slow infra cadence.
- **MAINTAIN MODE** (queue empty / everything gated): classic rotation — most-starved over-budget
  category from the LEDGER balance table; if that vein is SATURATED, record-verified + pivot.

## Categories & starvation budgets (MAINTAIN-mode rotation)
| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits. VERIFY findings firsthand against source. |
| **guard** | 6 | Merge-surviving regression prevention (committed HTTP-harness + source-scan tests). |
| **bug** | 3 | A concrete defect found in review/reported. Jump the queue when real. |
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, shared helpers, dead code. |
| **infra** | 6 | Loop tooling, harness, CI, docs, coverage re-measure + META-REVIEW cadence. |

### `arch` rules (refactors are the highest-risk work — READ before any arch increment)
1. ONE small reviewable refactor per cycle — never a sweeping rewrite.
2. Behavior-preserving: no observable API/UI/data change (else it's a bug/feature).
3. Test-anchored green→green; add the characterization test FIRST if coverage is missing.
4. Full verify gate; for UI-touching refactors, shot.sh before/after — must not move a pixel.
5. No churn-for-churn — name a concrete payoff, or record "no churn warranted" + pivot.
6. Big restructures (new layer, schema/money migration, tx-semantics) → `.kiro/specs/<refactor>/design.md`
   + `send_message` Angelo. Never self-authorize.
7. **FAST-DRY precondition (C286):** at cycle start, if `git log` over production-src (backend/src +
   frontend/src `*.ts`, EXCLUDING tests) shows NO commit since the last source-touching cycle, the dedup
   vein is structurally dry → record no-churn FAST + pivot; mark dormant, don't re-scout.

---

## BUILD QUEUE (the ordered build plan — pop the top unblocked slice; WIP=1)
> Greenlit 2026-06-24, ordered C349. Re-rank only when a slice finishes or a gate clears.

1. ~~**money-cents-migration**~~ — ✅ **DONE + SHIPPED (C19, commit 705b794).** Built atomic T1–T7 in ONE
   branch-green commit (Angelo's confirmed ruling). Money is integer cents end-to-end; dollars only at the
   input edge (Zod dollarsToCents) + response edge (per-entity *ToApi + analytics/api-transform). Backup 2.0.0
   + version-gated ×100 restore shim. Both validate:local green; FE dollar contract unchanged. Don't re-pick.
2. ~~**trips-location**~~ — ✅ DONE (pre-C11). Don't re-pick.
3. ~~**theming-engine**~~ — ✅ DONE (engine + 10 themes incl. neobrutalist C11). Don't re-pick.
4. ~~**vehicle-sharing**~~ — ✅ **COMPLETE (T0–T14, DONE C477 2026-06-27).** The full feature shipped on
   claude-loop-dev: schema + migration 0010 (T1), the ONE access seam utils/sharing.ts (T2), share-management
   routes (T3/T4), per-domain gate-widening — expense R/W + split (T5b), odometer R/W (T6), reminder R/W
   (T7/T7b), analytics READ (T8a), insurance policies + claims READ (T8b/T12b-3c) + per-vehicle stats (T12b-3c) —
   each with its cross-tenant-idor.test.ts entries; backup round-trip (T9); the FE (share dialog T11, shared-with-me
   T12b-1, fleet badge T12b-2, viewer-mode read-only incl. insurance T12b-3); and the T14 DoD gate (validate:local
   green both sides, IDOR sweep 19 pass, eyes-on all 3 surfaces zero-console-error). Don't re-pick.

> **The 4 original specs are DONE (C477):** money-cents ✅, trips ✅, theming ✅, vehicle-sharing ✅.

5. **VLM provider — receipt parsing** (TODO #11) — 🟡 **SPEC AUTHORED (C508, `.kiro/specs/vlm-receipt-parsing/`).**
   requirements + design + tasks committed (aeac5d6). ARCC-grounded (SAX-03 secrets / SAX-06 PII / LLM guardrails →
   design.md §7). KEY: a VLM is a NEW PROVIDER DOMAIN (domain:vlm) in the existing domain-agnostic user_providers →
   NO schema migration v1; api key reuses utils/encryption.ts (encrypted, stripped); parse route returns a DRAFT +
   persists NOTHING; user confirms via the UNCHANGED POST /expenses; image via the existing expense_receipts photo
   flow; model output UNTRUSTED → strict Zod fail-closed, never auto-written. **T0 = sign-off gate for 5 product/UX
   forks** (D1 adapter set / D2 self-hosted-in-v1 / D3 confidence UX / D4 provenance-defer / D5 cost+size cap — each
   has a RECOMMENDED option; ACK takes it). **T1 DONE (C509, 991b88f)** + **T2 DONE (C510, e56eebd)** — the fork-free
   plumbing is COMPLETE: the vlm provider domain (4 types + validateVlmProviderConfig on create+PUT + domain↔type
   guard + encryption-at-rest guard) AND the domains/vlm/ strategy registry + the fixed extraction prompt + the strict
   fail-closed parseExtraction schema (22-case guard). Both reuse the existing AES-256-GCM seam; no schema change.
   **T3a (C511) + T4 (C512) + T5a (C514, 3a3679f) DONE.** ✅ **The ENTIRE fork-free surface is SHIPPED, BE + FE:**
   T1 (provider domain) + T2 (registry + fail-closed schema) + T3a (openai-compatible/ollama adapter) + T4 (POST
   /api/v1/receipts/parse) + T5a (vlmApi.parseReceipt client). The backend receipt-parse feature is functionally
   COMPLETE behind a configured provider, and the FE has a typed client for it. ✅ **T0 RULED — Angelo ACK all
   recommended (2026-06-30):** D1 = OpenAI-compatible + Anthropic + Gemini + Ollama; D2 = ship self-hosted Ollama in
   v1; D3 = simple pre-fill, NO per-field confidence flags; D4 = DEFER the `sourceType:'receipt'` provenance tag (no
   `expenses` schema change in v1); D5 = 8MB image cap (already implemented). **UNBLOCKED — build the remaining tail
   in order, WIP=1. T3b DONE (C524, 2ab2e88)** anthropic+gemini; **T5b DONE (C525, 8c3cf21)** VlmProvidersCard settings
   UI; **T6 DONE (C526, bc83d05)** ReceiptScanButton on ExpenseForm — scan→prefill eyes-on verified (amount/date/
   mileage/category/description all pre-fill, image queued, R7 disclosure, four-states). ✅ **T7 DONE (C527, c45fc15 +
   cf17958) — THE FEATURE IS COMPLETE.** T7 = a DURABLE committed round-trip guard (`vlm-receipt-roundtrip.test.ts`,
   3 cases: parse→draft→map-as-form→POST /expenses→GET-back; pins 47.83 dollars→cents→dollars EXACT, odometer→mileage,
   vendor→description, category; re-asserts parse persists nothing) + an EYES-ON untracked Playwright e2e
   (`vlm-receipt-roundtrip.meshclaw.e2e.ts`, gitignored: full UI seam, live VLM mocked via page.route, photo via the
   fake-storage seam — scan→prefill→confirm→assert the expense row + the attached receipt photo persist). Eyes-on the
   prefilled form read (every field, image queued, zero console errors). Both sides validate:local GREEN (BE 2205 / FE
   1332). **All 8 slices shipped: T1 domain, T2 registry+schema, T3a openai/ollama, T4 parse route, T5a client, T3b
   anthropic+gemini, T5b settings UI, T6 scan button, T7 round-trip+DoD.** The live-VLM leg stays eyes-on-pending
   (needs a real provider key). The D4 provenance tag was NOT added (ruled defer). **DO NOT re-pick.**
6. **LLM provider — assistant** (TODO #12) — ✅ **DONE + SHIPPED (T1-T7, C542, commit 7dc8868). DO NOT re-pick.**
   The full assistant feature shipped on claude-loop-dev: the llm provider domain + the read-tool safety core
   (T1/T2), the 4 chat+tools adapters + registry (T3a/T3b), the bounded tool-calling orchestrator + the 3 ARCC
   guards + POST /api/v1/assistant/chat (T4), the assistant-api client (T5a), the LlmProvidersCard settings UI
   (T5b), the /assistant chat surface w/ R7 disclosure + R8 safe-text render + four-states (T6), and the T7
   DoD (the tool-result round-trip guard + the FE safe-render source-scan guard + the untracked eyes-on e2e).
   T0 ruled all-recommended (Angelo 2026-06-30). Both sides validate:local green (BE 2281 / FE 1428); the
   live-LLM leg stays eyes-on-pending (needs a real key). v1 is READ-ONLY (no write tool). **NEXT BUILD PICK:
   Photos→auto-expense (item 10) — the queue advances there (WIP=1).** [Historical detail below.]
   <details><summary>shipped-slice detail (C532-C542)</summary>

   🟡 **SPEC AUTHORED (C532, commit ddb4bb5, `.kiro/specs/llm-assistant/`).**
   requirements + design + tasks committed. ARCC-grounded (GenAI tool-use/agency + SAX-04 + confused-deputy +
   session-isolation → design §7). KEY: a NEW `domain:'llm'` in user_providers (REUSES the shipped VLM provider-
   domain plumbing); the chat route runs a BOUNDED tool-calling loop over a FIXED allowlist of READ-ONLY, userId-
   scoped tools (wrappers over the existing analytics/repos); **v1 is READ-ONLY** (no write tool → no model-driven-
   write risk class); authorization is NEVER the model's (session userId, never a model-supplied id); NO schema
   migration v1 (domain-agnostic providers; ephemeral history). **T0 = sign-off gate for 6 forks** (D1 adapter set /
   D2 read-only-vs-actions / D3 history persistence / D4 tool allowlist / D5 streaming / D6 caps — each RECOMMENDED;
   ACK takes it). **T0 ESCALATED to Angelo C532 (Slack); do NOT re-escalate (C153 back-off).** UNBLOCKED-NOW (fork-
   free, build while T0 pends, exactly like the VLM fork-free arc): **T1 DONE (C533, f85f076 + a032712)** provider-
   config generalized vlm→model-domain; **T2 DONE (C534)** the tool layer + IDOR guard (the safety core); **T3a DONE (C535)** openai-compatible adapter + registry; **T3b DONE (C536, 279f735 + a47e2d5 + 9a999c0 +
   db07db9)** the Anthropic + Gemini chat+tools adapters (dumb transport, each normalizes its wire shape to
   {text?,toolCalls?}) wired live → the registry resolves all 4 D1 types; 12-case guard. **ALL ADAPTER SLICES DONE.** **T4 DONE (C537, 9363c00 + route/mount + 7502805)** the bounded tool-calling
   orchestrator (the 3 ARCC guards per call: allowlist → Zod-validate → session-scoped; K=5/T=4 caps; honest
   exhaustion) + POST /api/v1/assistant/chat (SAX-04 input caps; no-provider 400; provider 502; PERSIST NOTHING)
   + the 10-case HTTP guard incl. the IDOR test. **★ THE ASSISTANT BACKEND IS COMPLETE (T1-T4), all fork-free,
   shipped while T0 pends.** **T5a DONE (C538, f2d2dc8)** the assistant-api.ts client (fork-free). **★ ALL FORK-FREE LLM WORK SHIPPED
   (T1-T4 backend + T5a client).** The remaining FE tail — T5b (settings card, surfaces D1), T6 (chat surface,
   honors D5), T7 (e2e+DoD) — all TOUCH the gated forks. **T0 RULED (Angelo ACK all recommended, 2026-06-30,
   commits c382d0b sibling) — D1 4-adapter set / D2 read-only / D3 ephemeral / D4 8 tools / D5 blocking / D6
   K=5,T=4; the shipped backend already used these → zero rework. THE FE TAIL IS NOW UNBLOCKED.** ★ This is the
   CLOSER feature (backend+client done, only the FE tail left, NO ARCC gate). **T5b DONE (C540, 768c3e9):**
   `LlmProvidersCard.svelte` on /settings — a CLONE of the eyes-on-verified VlmProvidersCard retargeted to
   domain:llm (Bot icon, read-only copy, llm-* testids) + a new LLM_PROVIDER_TYPES constant (same 4 D1 model
   types, chat-model defaults: Ollama llama3.1 not the vision llava); reuses provider-api.ts; four-states;
   eyes-on verified (card empty-state + add-dialog open w/ disabled save, zero console errors); FE
   validate:local GREEN. **T6 DONE (C541, 0c471e9):** the `/assistant` chat surface — a Bot nav route, a
   scrollable user/assistant-bubble transcript + Textarea input (Enter sends), four-states
   (loading/error/empty-no-provider/data), BLOCKING (D5), toolsUsed badges, R8 SAFE plain-text render
   (whitespace-pre-wrap, never {@html} — no markdown lib FE-side), the R7 first-use AlertDialog
   (localStorage vroom.llm.assistant-disclosed). Eyes-on verified across all 4 states + the R7 dialog + a
   DRIVEN stubbed-route send round-trip (bubbles + toolsUsed badges render), zero console errors; FE
   validate:local GREEN. **RESUME HERE NEXT (WIP=1): T7 (round-trip e2e + DoD)** — a committed
   source-scan/HTTP guard + the untracked Playwright e2e with a MOCKED llm provider (adapter fetch stubbed to
   script a tool-call THEN an answer): send a message → assert the orchestrator ran the stubbed tool → the
   reply renders. Feature-DoD: both sides validate:local green, the e2e green, eyes-on the chat surface
   (DONE C541), the privacy disclosure present (DONE C541), the IDOR/tool-scope guard green (the backend T2/T4
   guards). Tick the feature DONE. **Then the feature is COMPLETE** → move to Photos→auto-expense (item 10).
   **T7 DONE (C542, 7dc8868): the feature is COMPLETE — all 7 slices shipped, DoD met.**
   Do NOT re-escalate (settled).
   </details>
7. **Location integration** (TODO #13) — ✅ **DONE (shipped as expense-location, item 11 below, C549-C554).**
8. **Push notifications** (TODO #14) — 🟡 **SPEC AUTHORED + IN FLIGHT (C555, commit d1dab73,
   `.kiro/specs/push-notifications/`). ★ THE LIVE IN-FLIGHT BUILD ITEM (WIP=1).** EXTENDS the shipped reminder-
   notification feed (reminder_notifications — already fired/persisted/deduped/userId-scoped by the
   trigger-service) + the installed PWA: the net-new is a DELIVERY layer (Web Push), NOT a new notification
   model. requirements+design+tasks committed. **ARCC RAN + CLEARED (design §7, 2026-06-30):** VAPID private
   key = server-only env secret (SAX-05 isolation; never client-shipped/logged, only the public key crosses);
   the service worker is same-origin under VROOM CSP with NO new egress (push delivery is browser-internal);
   a push subscription = tenant-isolated user PII (IDOR-tested, in the backup, never logged); opt-in +
   honest. **T0 = sign-off gate for 6 forks** (D1 standard VAPID Web Push, no SaaS / D2 push on the EXISTING
   request-driven trigger, NOT a new scheduler — the central fork / D3 VAPID keypair as an env secret + a
   vapid:gen helper, OFF when unset / D4 switch vite-pwa to injectManifest + a custom src/service-worker.ts +
   DELETE the dead static/sw.js / D5 a settings opt-in card + disclosure, no auto-fired prompt / D6 disclose
   the request-driven timing limit honestly — each RECOMMENDED; ACK takes all). **T0 ESCALATED to Angelo C555
   (Slack ts 1782863564); do NOT re-escalate (C153 back-off).** **UNBLOCKED-NOW (fork-free, build while T0
   pends — the expense-location precedent):** ✅ **T1 DONE (C556, 96d73a1 + a33c395):** the 0013
   push_subscriptions table (userId-FK cascade + endpoint + p256dh/auth + userAgent + failureCount +
   lastSuccessAt; unique (userId,endpoint)) + migration 0013 + journal idx-13 + pushSubscriptionRepository
   (idempotent upsert, userId-scoped find/delete, reaping lifecycle) + an 8-case guard (round-trip, IDOR,
   cascade — PROVES 0013 applies). RIPPLE RESOLVED: push_subscriptions is EXCLUDED_BY_DESIGN from the backup
   (device-ephemeral, the sessions precedent — CORRECTED the spec's wrong auto-backup assumption). Backend
   validate:local GREEN (2314). ✅ **T2 DONE (C557, b0122f2 + b4b2e1e):** web-push@3.6.7 dep + CONFIG.push
   (3 VAPID env vars → enabled; private key server-only, never returned) + `GET /api/v1/push/vapid-public-key`
   on the new push router (503 PUSH_NOT_CONFIGURED when unset — the R6 degrade) + `bun run vapid:gen` +
   .env.example; a 4-case guard (503/401/source-scan the private key never leaks). Backend validate:local
   GREEN (2319). ✅ **T3 DONE (C558, f177d52 + 065a4ad):** POST/DELETE /api/v1/push/subscribe on the push
   router (Zod + SAX-04 caps; upsertByEndpoint/deleteByEndpoint userId-scoped; 201 id-only, keys never echoed;
   idempotent) + a 6-case guard (persist/readback, idempotent, anon→401, malformed→400, IDOR B-cannot-delete-A,
   per-user endpoint scoping). Backend validate:local GREEN (2325). **★ THE FORK-FREE BACKEND SURFACE IS
   COMPLETE (T1-T3).** ✅ **T4a DONE (C559, ea33435 + ee2f5c1):** T4 split — T4a (the PushSender transport seam
   + notifyUser fan-out/reaping lifecycle, best-effort R3) is fork-free (independent of D2) and SHIPPED with a
   7-case guard; backend validate:local GREEN (2332). **★ THE FORK-FREE BACKEND IS NOW EXHAUSTED (T1-T3 +
   T4a).** **ALL REMAINING PUSH SLICES TOUCH T0 FORKS:** T4b (WIRE the trigger-service hook — honors D2, the
   request-driven-trigger fork), T5 (the push-api client + push.ts + the settings card — honors D5), T6 (the SW
   push handler + the injectManifest switch + e2e + DoD — honors D4, the highest-risk slice, built last).
   **BLOCKED on the T0 ACK (Slack ts 1782863564, escalated C555; do NOT re-escalate — C153 back-off).**
   ✅ **HARDENED + DEEP-REVIEW-CERTIFIED (C560, 778efb5 + 3d822cb):** an adversarial review of the shipped
   push backend found + fixed a real blind SSRF (the subscribe endpoint was an unvalidated URL the sender
   POSTs to) — isAllowedPushEndpoint https+vendor-host allowlist at the route (400 pre-store) + the sender
   (defense-in-depth prune); 6-case guard; ARCC-grounded; design §7.5/§8. The reviewer verified
   IDOR/reaping/best-effort/migration/secrets ALL CLEAN. ✅ **FOLLOW-ON CLOSED (C561, ca6076a):** the
   per-user subscription CAP (maxSubscriptionsPerUser=20; upsertByEndpoint evicts the oldest past the cap —
   device-rotation-friendly, flood-bounded; +4-case guard). The push backend hygiene is now complete.
   ✅ **T0 ACK'd 2026-07-08 (ALL D1–D6 recommended) — THE GATE IS CLEARED.** The ~400-cycle gated hold
   (C563→C962) is over; the fork-dependent tail is unblocked, WIP=1. ✅ **T4b DONE (C963, da92637):** wired
   `firePushForNotification` into BOTH notification-insert sites (time + mileage) → notifyUser with a
   row-derived payload (dueOdometer→'Due at <n> mi' / else time-worded; title `<name> due`, tag reminder.id,
   url /reminders), best-effort await-and-swallow (R3), no-op when no VAPID; +4-case guard
   (trigger-push-hook.test.ts: time/mileage payloads, throwing-sender-does-not-fail-the-trigger, nothing-due-
   no-push). Backend validate:local GREEN (2345). **★ THE PUSH #14 BACKEND IS COMPLETE (T1–T4b).**
   ✅ **T5 DONE (C964, 9b05f3a + tick 1c8b686):** the FE opt-in surface — `push-api.ts`
   (getVapidPublicKey/subscribe/unsubscribe; DELETE carries `{endpoint}` in the body; 503→ApiError.code
   PUSH_NOT_CONFIGURED) + `push.ts` beside pwa.ts (isPushSupported / getNotificationPermission /
   urlBase64ToUint8Array / enablePush→discriminated outcome / disablePush + the PURE
   derivePushStatus/pushStatusLabel state machine — D6 timing-honest; getExistingSubscription uses
   getRegistration() NOT .ready so it can't hang the card pre-SW) + `PushNotificationsCard.svelte` (Switch +
   status line + the D5 first-enable AlertDialog gating the browser permission prompt + D6 copy, four-states)
   wired into settings/+page.svelte after PWAInstallCard. GUARD: push-api.test.ts (6) + push.test.ts (8). FE
   validate:local GREEN (1453, +14); EYES-ON verified (shot /settings — off-state toggle + disclosure dialog
   fire without the permission prompt, zero console errors). **NEXT PICK: T6** (the SW injectManifest switch +
   push/notificationclick handlers + delete the dead static/sw.js + e2e + DoD — D4, the highest-risk slice,
   BUILD LAST). Pop T6 next cycle. After push #14 DONE → Calendar #15 SPEC (greenlit, WIP=1-unblocked).
9. **Calendar integration** (TODO #15) — 🟢 **GREENLIT TO SPEC (Angelo 2026-07-08).** SPEC FIRST (the last
   remaining greenlit integration; spec it after push-notifications reaches DONE — T5+T6 — WIP=1).
10. **Pull from Google Photos → auto-add expenses** (TODO #16) — ✅ **DONE + SHIPPED (T1-T6 + ARCC, C547,
    commit 064c621). DO NOT re-pick.** The full feature shipped on claude-loop-dev: the live searchMediaItems
    read (T1) + the appcreateddata OAuth scope (T5, ARCC-cleared §7), the stage-endpoint orchestration
    GET /api/v1/photos/receipt-drafts (T2, persists nothing), the photos-import-api FE client (T3), the
    Import-from-Photos review surface (T4, eyes-on), and the round-trip guard + DoD (T6: stage→confirm→re-run
    idempotency via the photos:<id> clientId). T0 ruled all-recommended (Angelo). Both sides validate:local
    green (BE 2298 / FE 1433); the live Photos+VLM legs stay eyes-on-pending (need a real Google connection +
    key). v1 dedup is the clientId (no new table; the image stays in Google Photos). [Historical detail below.]
    <details><summary>shipped-slice detail (C539-C547)</summary>

    🟡 **SPEC AUTHORED (C539, commit bd985cd,
    `.kiro/specs/photos-auto-expense/`).** Converges the shipped VLM parse + the Google Photos provider. KEY
    CONSTRAINT (scout-surfaced): Photos read is APP-CREATED-ONLY — VROOM drafts the receipts IT uploaded to its
    album, NOT the camera roll (broad-library scope unavailable to a non-Workspace app); D1 ships it honestly.
    REUSES download/getFreshUrl + extractReceipt/parseExtraction + createIdempotent (clientId=photos:mediaId,
    no new table) + expense_receipts; the one new backend piece is searchMediaItems. **T0 RULED (Angelo ACK all
    recommended, 2026-06-30, commit c382d0b): D1 framing / D2 OAuth read-scope / D3 dedup-via-index / D4 ≤25 cap /
    D5 checklist.** Do NOT re-escalate (settled). **ARCC PRECONDITION STILL STANDS** (separate from the product
    ACK): a fresh search_arcc on the OAuth read-scope expansion runs before the T1-live search + T5 scope build.
    ★ **THIS IS THE LIVE IN-FLIGHT BUILD ITEM (WIP=1)** — the LLM-assistant (item 6) shipped DONE C542.
    **BACKEND COMPLETE (C543-C544):** ✅ T2 (the GET /api/v1/photos/receipt-drafts stage orchestration —
    resolve photos+vlm providers → listReceiptPhotos → filter already-imported → download → extractReceipt →
    parseExtraction → drafts, persists nothing; 3f162df) · ✅ the T0 ARCC check ran + CLEARED (design §7,
    954375c) · ✅ T1 (live searchMediaItems on the real PhotosClient) + ✅ T5 (the
    photoslibrary.readonly.appcreateddata OAuth read scope) — both ARCC-cleared, 655d00a. The route HTTP
    guard injects a fake-PhotosClient service (setPhotosServiceBuilderForTest) so the live-read path is
    tested zero-network (clean sweep / already-imported filter / transport-502). Backend validate:local
    GREEN (2295). ✅ **T3 DONE (C545, 67bc3e6):** photos-import-api.ts — getReceiptDrafts() over the T2 route
    + confirmDraft(photoId, input) POSTing /expenses with clientId=photos:<id> (the idempotency key); 5-case
    mocked-apiClient guard; FE validate:local GREEN (1433). ✅ **T4 DONE (C546, e148efe):**
    ImportFromPhotosDialog — the "Import from Photos" header entry → R7/D1-gated sweep → review checklist
    (per-row thumbnail + editable amount/date/category/vehicle + include checkbox) → batch "Add N expenses"
    (idempotent confirmDraft); four-states; eyes-on verified (data checklist + the disclosure gate, zero
    console errors). **RESUME NEXT at T6 — THE LAST SLICE** (round-trip e2e + DoD: an untracked
    `*.meshclaw.e2e.ts` with a MOCKED Photos provider + MOCKED VLM → open the dialog → review → confirm →
    assert N expenses persisted + their photo links + a re-run is a no-op [idempotency]. Feature-DoD: both
    sides validate:local green, the e2e green, eyes-on the review surface [DONE C546], the disclosure present
    [DONE C546]. Tick the feature DONE). **T6 DONE (C547, 064c621): the feature is COMPLETE.**
    </details>

> ★★ **BUILD QUEUE EMPTY (C547).** Every greenlit item is SHIPPED: money-cents ✅ / trips ✅ / theming ✅ /
> vehicle-sharing ✅ / VLM-receipt-parsing ✅ (C527) / LLM-assistant ✅ (C542) / Photos→auto-expense ✅ (C547).
> The remaining GREENLIT-TO-SPEC features are NOT yet started (each needs SPEC mode + Angelo product forks):
> **Location integration (TODO #13), Push notifications (TODO #14), Calendar integration (TODO #15).** Per
> Angelo decision-23 the SPEC step is pre-authorized — the loop MAY enter SPEC mode on the next one (write
> requirements+design+tasks, pop the fork-free T0/T1 slices, surface real UI/UX forks). Recommended order by
> leverage: the three are all integrations of similar value; pick Location (#13, the next ordinal) unless
> Angelo steers otherwise. If not speccing, fall to MAINTAIN cadence (saturated veins → record + pivot) or
> the infra cadence.

11. **Store location with expenses** (TODO #13, the unshipped half) — ✅ **DONE + SHIPPED (T1-T6, C554,
    commit b393731). DO NOT re-pick.** The optional free-text `expenses.location` column shipped end to end:
    schema + migration 0012 (T1), create/update Zod + round-trip guard (T2), CSV export/import round-trip
    (T3), FE type + transformer mapping (T4), the expense-form Location input + detail-row display (T5), and
    the e2e + DoD (T6). NO GPS (the trips D5 precedent); NOT ARCC-gated. Both sides validate:local green (BE
    2307 / FE green). Built on the D2/D4 recommended defaults; the T0 ACK (Slack ts 1782858626) is still
    pending but purely ratifies now. [Historical detail below.]
    <details><summary>shipped-slice detail (C548-C554)</summary>

    🟡 **SPEC AUTHORED (C548, commit
    4e83257, `.kiro/specs/expense-location/`).** ★ **THE LIVE IN-FLIGHT BUILD ITEM (WIP=1).** TODO #13's
    "Road trip! Trips tracking" half already shipped (trips-location); this is the unshipped "store location
    with expenses" — ONE additive optional free-text `expenses.location` column, NO GPS (the trips D5
    precedent), ~7 threading points each mirroring `description`. NOT ARCC-gated (design §7). **T0 ESCALATED
    to Angelo C548 (Slack ts 1782858626); do NOT re-escalate (C153).** T0 forks (each RECOMMENDED): D1
    free-text / D2 input placement / D3 leave VLM vendor→description AS-IS / D4 detail-row+CSV display.
    ✅ **T1 DONE (C549, cd4a4d2):** the additive `expenses.location` column + migration 0012 + journal +
    CONFIG bound + the Sheets-header thread. ✅ **T2 DONE (C550, 9575a80):** the create/update Zod `location`
    field (length-capped, .nullish() clear-on-edit) + the 5-case round-trip guard (persist/read-back, absent
    →NULL, clear-on-edit, untouched, over-cap 400). Backend validate:local GREEN (2303). ✅ **T3 DONE (C551, 03a055c):**
    CSV export (EXPORT_COLUMNS + record map) + native import (ImportableExpense + parseRow +
    deriveImportClientId hash) round-trip; a 3-case guard + a location field-sensitivity case; backup/Sheets
    auto-covered. Backend validate:local GREEN (2307). **★ ALL 3 FORK-FREE BACKEND SLICES DONE (T1-T3).**
    ✅ **T4 DONE (C552, 7b3f4f7):** FE type + transformer mapping + 6-case guard. ✅ **T5 DONE (C553,
    7ad3506):** the expense-form Location Input (after Description, D2) + create/edit payload wiring +
    edit-load + the D4 muted detail-cell display; eyes-on verified (the input renders, zero console errors);
    FE validate:local GREEN (1439). **RESUME NEXT at T6 — THE LAST SLICE** (e2e + DoD: a create-with-location
    round-trip through the form; the committed backend HTTP guards from T2/T3 are the merge-surviving net.
    Feature-DoD: both sides validate:local green, eyes-on the form [DONE C553]; tick the feature DONE). Then
    expense-location is COMPLETE → BUILD QUEUE empty → spec the next greenlit feature (push #14 / calendar
    #15). **T6 DONE (C554, b393731): the feature is COMPLETE.**
    </details>

> ★★ **BUILD QUEUE RE-FILLED (C555): push-notifications (#14) is the LIVE in-flight build item (item 8 above,
> WIP=1).** The C554-empty state was resolved by entering SPEC mode (decision-23) — the scout CONFIRMED the
> GUIDE's prediction (#14 is web-push delivery ON TOP of the existing reminder_notifications feed, NOT a
> greenfield: the notifications are already fired/persisted/deduped, only undelivered; the PWA+SW exist
> without push handlers). ARCC cleared (design §7). **NEXT-CYCLE PICK: BUILD mode — pop push #14 T1 (the 0013
> push_subscriptions schema + migration + repository, fork-free; the expense-location precedent builds the
> additive surface before T0).** Then T2 (VAPID env + public-key route + web-push dep), T3 (subscribe routes
> + IDOR) — all fork-free. Hold T4-T6 for the T0 ACK (Slack ts 1782863564). After push reaches DONE → spec
> Calendar (#15), the last remaining greenlit integration, WIP=1.
> The expense-location T0 ACK (Slack ts 1782858626) remains pending but that feature shipped fully on
> recommended defaults (ratify-only; do NOT re-escalate, C153).

> **23 (2026-06-29): ALL remaining features are GREENLIT TO SPEC.** Per Angelo "all features are open to spec —
> mark all as greenlit to spec." This means the SPEC step (requirements.md + design.md + tasks.md, surface real
> UI/UX decisions) is pre-authorized for each — the loop may write the spec and pop its T0 slices WITHOUT a fresh
> per-spec greenlight. Real product UI/UX forks discovered DURING spec authoring still surface to Angelo (the spec
> is greenlit, individual design calls inside it are not blank-cheque). WIP=1 — finish the approved-bug queue
> below OR one feature spec before starting another; don't spec all six at once. Recommend ordering by leverage:
> receipt-parsing (VLM) + Photos→auto-expense are the highest user-value; assistant (LLM) next; location/push/
> calendar are integrations that can follow.

> Until a feature spec is in flight, the **ANGELO-APPROVED bug/arch queue** (items 1–22 below) is the live BUILD
> work — pop those as `bug`/`arch` slices (HIGH data-safety 1–4 first). The loop is no longer in MAINTAIN-only
> mode. Known infra follow-on: the route-smoke `networkidle` flake (harden the 15 gotos).

> NOTE/lesson (C166→C167): a parallel-agent Angelo greenlight lands as a committed T0 flip with NO
> in-session message — that IS legitimate authorization. Don't revert a committed greenlight as
> "fabricated"; ASK first.

---

## ✅ ANGELO-APPROVED actionable queue (ruled 2026-06-29) — pop as `bug`/`arch` BUILD slices, WIP=1
> Angelo ruled all 23 parked decisions en masse 2026-06-29 (decision-doc batch; "ACK" = agreed the recommended
> option). Each line below is now ACTIONABLE with its DECIDED option — **do NOT re-escalate, build it.** Full
> per-item grounding is in `loop/archive/BACKLOG-C1-C350.md` + the CLAUDE.md bug snapshot; read the grounding
> before building, but the OPTION is settled. Order = severity (HIGH data-safety first), then quick wins, then tail.

### HIGH — data-safety (build first)
1. ~~**#36 Sheets backup `USER_ENTERED`**~~ — ✅ **ALREADY DONE (verified C478 scout, stale doc-drift).** RAW is live
   at `google-sheets-service.ts:737` with the explanatory no-escape-on-read comment + 2 committed guards
   (`sheets-raw-value-input.test.ts` source-scan + a behavioral test). Shipped pre-reset (C24). Do NOT rebuild.
2. ~~**#37 non-atomic in-place Sheets rewrite**~~ — ✅ **ALREADY DONE (verified C478 scout, stale doc-drift).** The
   stage-to-`__vroom_staging` + atomic `batchUpdate` swap is live (`writeAllSheetsAtomically`, zero `values.clear()`),
   guarded by `sheets-atomic-backup.test.ts`. Folded into the schema-redesign rewrite. Do NOT rebuild.
3. ~~**#127 replace-mode restore wipe+insert non-atomic**~~ — ✅ **DONE (C479, commit 4c44f1b).** Both restore
   paths' tx callbacks + deleteUserData + insertBackupData are now fully SYNCHRONOUS (.run()/.all()), so wipe+insert
   share ONE real transaction that rolls back atomically on a mid-insert throw. Guarded by restore-atomicity.test.ts
   (tampered-ZIP duplicate-id → throws UNIQUE + original data survives). The C151 async-tx footgun class is CLOSED
   on the restore path. validate:local green.
4. ~~**#43/#44 backup-honesty fail-open**~~ — ✅ **DONE (C478, commit 1d87e67).** Strategy success = all attempted
   capabilities ok; orchestrator outcome success/partial/failed/noop + sync-anchor advances only on a clean run
   (failed provider retries); route failed→502 / partial→207 / ok→200. Guards on all 3 layers. validate:local green.

### Quick product calls — ✅ ALL ALREADY DONE (verified C480, stale doc-drift from the pre-reset CLAUDE.md snapshot)
5. ~~**#148 lease burn-bar 0-used on null `initialMileage`**~~ — ✅ DONE. `financing-calculations.ts:503`
   `const startMileage = initialMileage ?? 0;` shipped C149; the lease-metrics.test anchor asserts the FIXED semantics.
6. ~~**#129 OAuth login email overwrite**~~ — ✅ DONE (commit e8241e9, C155). `updateExistingUserProfile`
   (auth/routes.ts:203-215) writes `users.email` only when the stored value is empty (`!current?.email`); guarded by
   login-email-preservation.test.ts + preservation-login-sync.property.test.ts.
7. ~~**#94 fleet analytics pool unit-bearing scalars**~~ — ✅ DONE (C58–C79). Every pooling builder threads
   `vehicleUnitsMap` + `skipConversion` and converts to user-global units before pooling (computeConverted*/buildConverted*);
   guarded by no-unconverted-fleet-pooling.test.ts (tree-wide source-scan) + fuel-stats-fleet-distance-pooling.test.ts.

### Semantics / display — ✅ ALL ALREADY DONE (verified C480, stale doc-drift)
8.  ~~**#69 monthly-only insurance term absent from TCO**~~ — ✅ DONE (C34). `effectiveTermCost` materializes
    monthlyCost×months in insurance/hooks.ts.
9.  ~~**#79 malformed offline fuel entry stuck in outbox**~~ — ✅ DONE. sync-manager.ts:163 parks a `permanent`-failure
    row via `markExpenseNeedsAttention` + `getNeedsAttentionExpenses`; drops out of `getPendingExpenses` (no silent re-attempt).
10. ~~**#85 fuel-stats "This/Last Year" range-relative**~~ — ✅ DONE (C36). FuelStatsTab.svelte:170/211 reads
    "This Period"/"Last Period"; the calendar rows stay "This/Last Month".
11. ~~**#30 MPG outlier-band divergence**~~ — ✅ DONE (C20). `MIN_VALID_MPG`/`MAX_VALID_MPG`/`MIN_VALID_MI_KWH` live in
    calculations.ts; analytics-charts.ts imports them; the inline `<150` in vehicle-stats is gone.
12. ~~**#88 split recurring reminder names a deleted vehicle**~~ — ✅ DONE (C48). `pruneSplitConfigsForDeletedVehicle`
    + `pruneVehicleFromSplitConfig` on vehicle-delete (drop leg / rescale % / clear blob if <2 legs).
13. ~~**#97 reminder linked ONLY to the deleted vehicle stays active**~~ — ✅ DONE (C40). `deactivateVehicleless` on
    vehicle-delete.
14. ~~**#100 un-serialized prefs read-modify-write**~~ — ✅ ACCEPTED WONTFIX-by-design (single-user deployment; no code).
15. ~~**#24 CSV decimal separator**~~ — ✅ CLOSED (last-separator-wins, #124/C417).

### Design/visual tail — ✅ RULED by Angelo 2026-06-30 (ACK all recommended). Now LOOP-SHIPPABLE in order, WIP=1, AFTER the VLM tail.
16. ~~**CSV-apostrophe round-trip**~~ — ✅ **DONE (C528, commits d0c534c + 4321719 + 2673413).** The own-export →
    own-import round-trip is now LOSSLESS for a user value like `'=Daily`: csv-safety.ts uses a MATCHED invertible
    escape on a shared `isApostropheRunThenTrigger` predicate — neutralize adds exactly one leading `'` to any
    apostrophe-run-then-trigger value (`'=Daily`→`''=Daily`; a bare `=formula` still gets its OWASP text-prefix),
    denormalize peels one layer (requiring a real leading `'`, so a bare foreign `=formula` is preserved). The pair
    is a true inverse for EVERY value; the foreign leading-`'`-before-non-trigger import contract is untouched; the
    backup/sync round-trip is unaffected (never neutralizes). The C401 characterization flipped to a lossless
    round-trip assertion (48 unit) + an HTTP guard proving `'=Daily mention` survives create→export→import EXACTLY
    (25 import). validate:local GREEN (2221 pass). Do NOT re-pick.
17. ~~**#112 ≥6 vehicles reuse chart colors**~~ — ✅ **DONE (C529, commits c4cb89e + 1321d8f).** Extended the palette
    5→8: added `--chart-6/7/8` to the ThemeTokenKey union + THEME_TOKEN_KEYS, all 21 registry token maps, app.css
    (:root + .dark + @theme map), and the CHART_COLORS array; regenerated themes.css from the registry. New tokens
    generated deterministically (complementary-hue rotation at each variant lightness band) + VERIFIED with the exact
    WCAG math — every chart-6/7/8 clears 3:1 vs card and is distinct from 1..5 on all 20 non-default variants; the
    C347 contrast guard CHART_KEYS now enforces all 8. Eyes-on: computed --chart-1..8 resolve to 8/8 distinct colors
    in a real browser (default L/D, aurora, neobrutalist), zero console errors. FE validate:local GREEN (1392 vitest).
    Chose 8 (the floor of the 8–10 rec — keeps the diff reviewable). Do NOT re-pick.
18. ~~**#135 SyncManager reaps synced rows**~~ — ✅ **DONE (C481, commit a8c1863).**

### ~~async-tx atomicity hardening~~ — ✅ **DONE (C504, commit 8789f65).** Angelo greenlit fixing all 7 in one cycle.
All 7 genuine C151 multi-write gaps converted to SYNCHRONOUS transaction callbacks (.run()/.all()/.get() inline):
auth signup, expenses create/updateSplitExpense, insurance create/addTerm/updateTerm, reminders create/updateWithVehicles,
providers photo-ref backfill. Sync helper siblings added (createSiblingsSync / insertJunctionRowsSync /
insertVehicleJunctionsSync); transaction() helper retyped to accept sync|async. Guarded by async-tx-atomicity.test.ts
(forces a mid-tx FK violation, asserts atomic rollback; both invocation paths). The C151 footgun CLASS is CLOSED
codebase-wide (restore C479 + all 7 repos C504). 13 audited-benign sites unchanged. Do NOT re-pick.

> **UPDATE 2026-06-30: the design/visual tail is now RULED + loop-shippable.** Angelo ACK'd all recommended on the VLM
> T0 forks (D1–D5) AND the design tail (#333/#343/#112 + CSV-apostrophe). The C482 "backlog is EMPTY / not loop-
> shippable" note is SUPERSEDED. **Build order (WIP=1):** ✅ the VLM feature is DONE (C527, all 8 slices). **NOW the
> design tail is the live BUILD work, IN THIS ORDER (the loop pops the top UNDONE one):**
>   1. ✅ **CSV-apostrophe own-export fidelity** (item 16) — DONE C528 (d0c534c + 4321719 + 2673413).
>   2. ✅ **#112 chart palette --chart-6..8** (item 17) — DONE C529 (c4cb89e + 1321d8f).
>   3. ✅ **#333 PWA theme-color** (item 20) — DONE C530 (7084c0d + 93f38fe + 89d1122).
>   4. ✅ **#343 default-token re-tune** (item 21) — DONE C531 (6652771).
>
> ★ **THE RULED DESIGN TAIL IS COMPLETE (C528–C531).** Together with the VLM feature (C527), ALL greenlit
> BUILD-QUEUE work is now SHIPPED. The unblocked queue is EMPTY. **NEXT:** the remaining features (items 6–10
> below) are GREENLIT-TO-SPEC — the loop may author a spec + pop its fork-free T0/T1 slices WITHOUT a fresh
> greenlight (Angelo decision 23), WIP=1, surfacing any real product UI/UX fork found during spec authoring.
> Recommended next pick: **LLM-assistant (item 6)** — next in the build-queue order — OR **Photos→auto-expense
> (item 10)**, the joint-highest user-value per the note below. Enter SPEC mode next cycle.
> All have ruled, recorded options above — do NOT re-escalate; grep-before-pick each one first (C480), then build.
> Do NOT add the D4 provenance tag.

### Theming chrome (LOW — ✅ RULED by Angelo 2026-06-30 ACK all; verify-before-building still applies — grep the source first)
19. ~~**#339(B) theme reconcile "server wins" clobbers a local pick**~~ — ✅ DONE. `theme.svelte.ts:142`
    reconcileServerTheme is "a no-op when … the server value is absent/empty" (mirrors the #129 ruling).
20. ~~**#333 PWA `<meta theme-color>` ignores the theme**~~ — ✅ **DONE (C530, commits 7084c0d + 93f38fe + 89d1122).**
    theme.svelte.ts now drives the meta from the RESOLVED variant background token in THEME_REGISTRY via a new
    oklch-to-hex.ts converter (OKLab→sRGB→hex, same matrices as the contrast guard; null→fallback). Unknown id →
    default surface (R8 degrade); unconvertible token → mode hex; never blank. Guards: oklch-to-hex.test.ts (12) +
    theme-store.test.ts (meta tracks the theme surface + a setTheme re-tint suite). Eyes-on via the picker-drive
    method (C340): Aurora→#f5f8ff, Cyberpunk→#eef7fa, Default→#ffffff, zero console errors. The live address-bar
    tint is a manual follow-up (not a gate, per the ruling — browser chrome is not shot.sh-capturable). FE
    validate:local GREEN (1407 vitest). Do NOT re-pick.
21. ~~**#343 `default`-palette chart colors < WCAG 3:1**~~ — ✅ **DONE (C531, commit 6652771).** The 3 sub-3:1 default
    tokens (light chart-4 1.72 + chart-5 2.15, dark chart-1 2.60) were re-tuned with a minimal lightness nudge
    (hue+chroma preserved) to clear 3:1 (3.10/3.10/3.11), mirrored in BOTH app.css + the registry DEFAULT maps so
    the default≡app.css identity guard stays green at the new values (the intended baseline change). REBASELINE: the
    C343 carve-out is removed — the C347 chart-contrast gate now folds `default` in (allThemes), so every built-in
    theme incl. default is held to 3:1. Eyes-on: the new values ship via app.css (browser-confirmed), zero errors.
    FE validate:local GREEN (1423 vitest). Do NOT re-pick.

> **C480 verification sweep finding (IMPORTANT — process correction):** items 5–15 + #339(B) were ALL already
> shipped pre-reset; they were stale carry-overs from the CLAUDE.md bug SNAPSHOT (which self-documents as
> "superseded by the loop docs"). Of the original 23-decision queue, only the HIGH data-safety trio that was
> genuinely open (#43/#44, #127) + the already-done audit needed loop work. **Before picking ANY remaining
> backlog bug, grep the named file/symbol to confirm it is actually open** — do not trust the one-liner. The
> only plausibly-open items left are the LOW tail: #333, #343 (theming chrome), and the CSV-apostrophe /
> #112 / #135 trio (each needs a file-level check first).

### Resolved doc-drift
22. **C214 trips↔odometer lifecycle** — CONFIRMED DONE (shipped as trips **T7**, ratified + built post-reset C3).
    Removed from the OPEN queue as stale carry-over. Do NOT re-pick.

---

## OPEN — loop-buildable (no gate; fills a maintenance cycle when the build queue is between slices)
- **deep-review / guard / arch / bug** are at STEADY-STATE SATURATION across the swept surfaces (the
  C253–C349 arc certified ~12 subsystems CLEAN firsthand). A real new finding now comes from: (a) a
  fresh feature surface as the BUILD QUEUE lands code, or (b) a NOT-YET-AUDITED shipped subsystem. On a
  MAINTAIN pick of a saturated vein: record-verified + pivot (don't re-scout — fast-dry precondition).
  **The push backend (the last fresh source, C556-C561) is now fully worked: deep-review-certified (C560,
  SSRF fixed) + hygiene-capped (C561) + arch-dedup-scouted-dry (C562). It is DORMANT — do NOT re-scout any
  push vein until push T4b+ lands new source (which needs the T0 ACK).** So with the build queue T0-gated,
  ALL veins are now saturated/gated/dormant → the gated-loop one-line dry pivot until T0 clears or Calendar
  (#15) is picked for SPEC.
- **infra** is the one always-productive maintenance vein: ~every 10 cycles re-measure coverage + untracked-
  test sweep + doc-freshness; ~every 25 cycles ALSO run the META-REVIEW (GUIDE §META-LOOP).

> The high-leverage work is the BUILD QUEUE (money-cents first) + clearing the gated steers above.
> Everything else is hardening that pays off only as new SOURCE lands.
