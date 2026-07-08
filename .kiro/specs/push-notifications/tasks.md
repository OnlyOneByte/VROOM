# Push Notifications — Tasks

> Backend-first per CLAUDE.md (subscription store → VAPID config + public-key route → subscribe/unsubscribe
> routes → send-on-create hook → frontend client+card → service-worker push handler). **The SPEC is
> greenlit-to-spec (Angelo decision 23).** This feature EXTENDS two shipped systems — the persistent
> `reminder_notifications` feed (the trigger-service writes it) and the installed PWA — so most slices REUSE
> existing seams (the userId-scoped-row pattern, the DI-test seam, `registerSW`). One task per `feature`
> cycle, each independently verified via `bun run validate:local`; never commit red.
>
> KEY GROUNDING (do not re-derive — scout-confirmed C555, design §0):
> - The notification SOURCE-OF-TRUTH already exists (`reminder_notifications`, schema.ts:554, written by
>   trigger-service.ts time `:263` + mileage `:403`); push RIDES one push per newly-inserted row — NO new
>   notification model.
> - The trigger is REQUEST-DRIVEN (no scheduler exists); v1 pushes on the existing triggers (D2/D6) — a
>   guaranteed-time daily nudge is a named follow-on, NOT this spec.
> - The PWA + SW exist (`@vite-pwa/sveltekit`, `generateSW`) but have NO push handlers + a DEAD `static/sw.js`;
>   D4 switches to `injectManifest` + deletes the dead file.
> - VAPID keypair = an APP-WIDE env secret (D3), NOT a per-user `user_providers` credential; the private key
>   is server-only (ARCC §7.1). `web-push` is a net-new backend dep. Highest migration 0012 → new = 0013.
> - **ARCC CLEARED (design §7, ran 2026-06-30)** — the credential/PII/SW surface is governance-cleared; the
>   D1–D6 product/architecture forks remain a SEPARATE T0 sign-off.

## Phase 0 — sign-off (gates the FORK-DEPENDENT slices; the additive store may build first)
- [x] **T0 — Angelo ACK the D1–D6 forks — ✅ ACK'd 2026-07-08, ALL recommended.** D1 = standard VAPID Web Push
      (self-hostable, no SaaS); D2 = push on the EXISTING request-driven trigger (NOT a new scheduler in v1);
      D3 = VAPID keypair as an env secret (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) + a `vapid:gen`
      helper, OFF when unset; D4 = switch `@vite-pwa/sveltekit` to `injectManifest` + a custom
      `src/service-worker.ts` + DELETE the dead `static/sw.js`; D5 = a settings opt-in card + first-enable
      disclosure (no auto-fired prompt); D6 = explicitly disclose the request-driven timing limit (no
      guaranteed-nudge over-promise). **The fork-free backend (T1–T4a + SSRF + cap) was already built to these
      exact defaults (C556–C561), so the ACK is ZERO-rework — it unblocks T4b (trigger hook) → T5 (settings
      card) → T6 (SW switch), in order, WIP=1.** Angelo ALSO greenlit Calendar #15 to spec (the last remaining
      greenlit integration; spec it after push #14 reaches DONE, WIP=1). Original escalation C555; ACK'd here.

## Phase 1 — backend store + config + routes (fork-free additive plumbing)
- [x] **T1 — Schema + additive migration 0013 + the repository (C556, 96d73a1, fork-free).** Added
      `push_subscriptions` (schema.ts, design §1: userId-FK cascade, endpoint, p256dh, auth, userAgent?,
      failureCount, lastSuccessAt?, createdAt; a `ps_user_idx` (userId) index + a unique `ps_user_endpoint_idx`
      (userId,endpoint) index) + `0013_push_subscriptions.sql` (additive CREATE TABLE, the 0010-class — NOT a
      rebuild) + the journal idx-13 entry. Added `pushSubscriptionRepository` (upsertByEndpoint via
      onConflictDoUpdate on (userId,endpoint) — idempotent re-subscribe, resets failureCount; findByUser /
      deleteByEndpoint — both userId-scoped; incrementFailure / markSuccess / prune — the reaping lifecycle).
      GUARD `push-subscription-repository.test.ts` (8 cases) drives the REAL repo against a fresh in-memory DB
      from the actual migration chain, so it PROVES 0013 applies — round-trip, idempotent re-subscribe (no dup),
      many devices/user, findByUser userId-scoped, deleteByEndpoint IDOR (user B cannot delete user A endpoint),
      the reap lifecycle, the user-delete FK cascade. **RIPPLE RESOLVED (the backup-coverage drift guard forces
      a deliberate decision on any new schema table):** `push_subscriptions` was added to `EXCLUDED_BY_DESIGN`
      beside `sessions`/`user_providers` — device-ephemeral secrets re-derivable on re-subscribe; a restored
      stale subscription would push to a dead endpoint (the `sessions` rationale). This CORRECTS the design's
      "auto-flows into the backup" assumption — it is deliberately NOT backed up (so NO SHEET_HEADERS thread was
      needed, unlike expense-location T1). Backend validate:local GREEN (2314, +7). NEXT: T2.
- [x] **T2 — VAPID config + the public-key route + the `web-push` dep + `vapid:gen` (C557, b0122f2,
      fork-free).** Added `web-push@3.6.7` + `@types/web-push` (lockfile churn is only web-push + its transitive
      deps — no unrelated drift). Added `CONFIG.push` (reads VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT;
      `enabled` = all three present) — the private key stays server-side (T4 signs with it), NEVER returned by a
      route. `GET /api/v1/push/vapid-public-key` on the NEW `push` router (mounted /api/v1/push, requireAuth) →
      `{ publicKey }` when enabled, else **503 `PUSH_NOT_CONFIGURED`** (the R6 honesty degrade, not a 500/blank).
      `bun run vapid:gen` (src/scripts/gen-vapid-keys.ts) prints a fresh keypair + the .env lines; .env.example
      documents the 3 vars as optional. GUARD `vapid-public-key-route.test.ts` (4 cases): unconfigured → 503
      (the harness sets no VAPID env + CONFIG is a process-cached snapshot [the ALLOW_FAKE_STORAGE lesson], so
      the harness NATURALLY exercises the OFF path — the default deployment state); anon → 401; a source-scan
      invariant that the route NEVER reads the VAPID private key while it DOES serve the public key. ARCC-aligned
      (design §7.1/§7.2): server-only env secret (SAX-05); app CSP already tight, no new egress. Backend
      validate:local GREEN (2319, +5). NEXT: T3.
- [x] **T3 — subscribe / unsubscribe routes (C558, f177d52, fork-free).** Added `POST /api/v1/push/subscribe`
      (Zod-validates `{endpoint, keys:{p256dh,auth}, userAgent?}` with SAX-04 length caps [endpoint 2000, keys
      512, userAgent 512] → `upsertByEndpoint(ctx.userId,…)`, idempotent — returns 201 with the row id ONLY, the
      crypto keys are NEVER echoed) + `DELETE /api/v1/push/subscribe` (`{endpoint}` → deleteByEndpoint, an
      idempotent no-op on an unknown endpoint) on the push router. Session-authed; userId = ctx.userId, NEVER
      the body (the endpoint is not a capability). NOT gated on CONFIG.push.enabled — a browser may register
      regardless of whether THIS server can currently send (the send hook checks enablement at T4). GUARD
      `subscribe-routes.test.ts` (6 cases, HTTP harness + a 2nd minted user B): POST persists + reads back (201,
      id only, keys not echoed); POST idempotent; anon→401; malformed body→400; DELETE removes + idempotent
      no-op; **IDOR — user B cannot delete user A endpoint** (B no-op, A row survives); the same endpoint string
      is per-user (A + B each own their row). Backend validate:local GREEN (2325, +6). **★ THE FORK-FREE BACKEND
      SURFACE IS COMPLETE (T1–T3).** T4 is the trigger hook (honors D2 — the request-driven-trigger fork).

## Phase 2 — backend send (T4 splits: T4a fork-free send/lifecycle · T4b the D2-gated trigger hook)
- [x] **T4a — the PushSender seam + `pushService.notifyUser` (C559, ea33435, fork-free).** Defined the
      `PushSender` interface + `PushResult` ({ok|gone|transientError}); the REAL `webPushSender` wraps
      `web-push.sendNotification` (setVapidDetails once; a WebPushError 404/410→gone, else transientError); a
      FAKE via `setPushSenderForTest` (the PhotosClient/VLM DI pattern). `notifyUser(userId, payload)` fans out
      over the user's subscriptions + applies the reaping lifecycle (ok:markSuccess / gone:prune /
      transientError:incrementFailure + reap past `CONFIG.validation.push.maxConsecutiveFailures` [#135]);
      **BEST-EFFORT — wrapped so it NEVER throws into the caller + NEVER blocks** (R3). The real transport is
      skipped when the server has no VAPID keypair (a config gap ≠ a failed send → failureCount untouched); an
      injected sender always runs. GUARD `push-service.test.ts` (7 cases): ok/gone/transient/cap-reap,
      many-device fan-out summary, best-effort swallow (a throwing sender does not abort the fan-out), scope.
      Refactored the per-subscription branch into a helper to stay under the biome complexity bar (the one gate
      catch this cycle). Backend validate:local GREEN (2332, +7). **This is the fork-free HALF** — the send +
      lifecycle any caller can invoke.
- [x] **T4b — WIRE the trigger-service hook (honors D2 — T0 ACK'd 2026-07-08).** After a `reminder_notifications`
      row is inserted in BOTH `processNotificationPeriod` (time) and `processMileageReminder` (mileage), the
      trigger-service now calls `firePushForNotification(reminder, created)` → `notifyUser(reminder.userId,
      payloadFromReminder(reminder, created))`. `payloadFromReminder` derives the payload off the ROW (not a
      guess): `{title:'<name> due', body: dueOdometer!==null ? 'Due at <n> mi' : 'This reminder is now due',
      tag:reminder.id, url:'/reminders'}` — the mileage/time axis read from which of dueOdometer/dueDate is set;
      NO PII beyond the user-authored reminder name (design §4). BEST-EFFORT (R3): notifyUser is already wrapped
      to never throw (T4a), and the hook await-and-swallows so a slow/failing push can neither fail nor stall the
      sweep; when the server has no VAPID keypair notifyUser is a no-op (config gap ≠ send failure), so this is
      inert on a never-configured deployment. GUARD `trigger-push-hook.test.ts` (4 cases, real trigger endpoint +
      the T4a fake-sender DI seam): a TIME notification fires the reminder-derived payload; a MILEAGE notification
      fires the 'Due at 60,000 mi' body; a THROWING sender does NOT fail the trigger (still 200 + the
      notification row is still written — the R3 best-effort proof, non-vacuous); nothing-due fires no push.
      Backend validate:local GREEN (2345 pass, +4; tsc 0, check:musl 0, build). **★ THE BACKEND IS COMPLETE
      (T1–T4b); the remaining T5–T6 are the FE tail (now unblocked — D5/D4).**

## Phase 3 — frontend (honors D5/D4 — eyes-on tail)
- [ ] **T5 — the push-api client + `push.ts` utils + the settings card.** `push-api.ts`
      (getVapidPublicKey/subscribe/unsubscribe); `push.ts` beside `pwa.ts` (isPushSupported feature-detect,
      enablePush = requestPermission→pushManager.subscribe(applicationServerKey)→POST, disablePush =
      sub.unsubscribe()+DELETE, urlBase64ToUint8Array helper). `PushNotificationsCard.svelte` (settings) — a
      toggle + a status line (not-supported / not-configured-503 / denied / subscribed / off), the first-enable
      AlertDialog disclosure (D5 + the D6 timing-honesty copy + off-anytime), localStorage disclosure flag,
      four-states + a11y + mobile-first. GUARD: a mocked-apiClient client test + the card's state machine.
      EYES-ON (boot + shot /settings + Read): the card renders each state, zero console errors. FE
      validate:local GREEN.
- [ ] **T6 — the service-worker push handler + the strategy switch + e2e + DoD (the gated, highest-risk
      slice — BUILD LAST).** Switch `vite.config.ts` to `strategies:'injectManifest'` + author
      `src/service-worker.ts` (precacheAndRoute(__WB_MANIFEST) + a `push` listener → showNotification + a
      `notificationclick` → focus/openWindow('/reminders')). DELETE the dead `static/sw.js`. Verify the FE
      build emits the SW WITH the push handlers (a build-output assertion / source-scan). EYES-ON: boot + the
      settings card enable flow renders; the SW registers. An untracked `*.meshclaw.e2e.ts` drives the
      subscribe toggle + asserts the POST /push/subscribe round-trip (the live cross-vendor push DELIVERY stays
      eyes-on-pending — it needs a real installed PWA + a real browser push service, like the live-VLM/Photos
      legs). Feature-DoD: both sides validate:local green, the committed backend guards (T3 IDOR + T4 send
      hook) are the merge-surviving net, eyes-on the card + the SW build, the privacy disclosure present (T5),
      the request-driven-timing honesty disclosed (D6). Tick the feature DONE.

## Notes
- **EXTENDS, does not greenfield** — the notification source (`reminder_notifications`), the userId-scoped-row
  pattern, the DI-test seam, and `registerSW` all already exist. The net-new is: one additive table (0013),
  the `web-push` dep + VAPID env config, the subscribe/store routes, the best-effort send hook, and the SW
  push handler.
- **WIP=1:** this is the only in-flight feature; finish it before starting Calendar (#15, the other remaining
  greenlit-to-spec integration).
- **ARCC CLEARED (design §7)** — VAPID private key = server-only env secret (SAX-05); push subscription =
  tenant-isolated user PII; the SW is same-origin under VROOM's CSP with no new egress; opt-in + honestly
  disclosed. No blocking finding. The D1–D6 forks are a SEPARATE product/architecture sign-off (T0).
- **Honesty boundary (D6):** v1 delivers "a push when VROOM runs a reminder check" (request-driven), NOT a
  guaranteed scheduled nudge. A background-trigger runner is a named follow-on infra spec — do NOT silently
  imply guaranteed timing.
