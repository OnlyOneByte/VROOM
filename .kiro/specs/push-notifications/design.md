# Push Notifications — Design

> Backend-first per CLAUDE.md (subscription store → VAPID config + public-key route → send-on-create hook →
> frontend subscribe UI → service-worker push handler). Nothing that depends on a fork (D1–D6) builds until
> T0; the schema/store/route plumbing (T1–T3) is fork-free additive and MAY build first (the expense-location
> precedent: the additive column built before T0). ARCC §7 below is a PRECONDITION on the credential-handling
> surface and is CLEARED.

## §0 — Grounding (scout-confirmed, do not re-derive)
- **The notification source-of-truth already exists.** `reminder_notifications` (schema.ts:554) — userId-FK,
  `dueDate` XOR `dueOdometer`, `isRead`, ordered `desc(createdAt)`, deduped (unique on (reminderId,dueDate)
  time + partial-unique on (reminderId,dueOdometer) mileage), `limit(100)`. The trigger-service WRITES it:
  time axis `processNotificationPeriod` (trigger-service.ts:263), mileage axis `processMileageReminder`
  (:403). Push RIDES this row — one push per newly-inserted notification. NO new notification model.
- **The trigger is REQUEST-DRIVEN — there is NO scheduler.** Firing happens on the `/trigger` route
  (login/poll full sweep) + `recheckMileageReminders` (synchronous, post odometer/expense write). This is
  the D2/D6 fork: v1 pushes on these existing triggers; a guaranteed-time daily nudge needs a background
  runner that does not exist.
- **The PWA + SW exist; push handlers do not.** `@vite-pwa/sveltekit` v1.1.0 (`vite.config.ts:10`) with the
  workbox **`generateSW`** strategy → the live SW precaches + does navigation-fallback, with NO `push`/
  `notificationclick` listener. `registerSW({immediate:true, onRegistered(r){…}})` is wired in
  `+layout.svelte:96` — `onRegistered` hands back the `ServiceWorkerRegistration` (the natural
  `.pushManager.subscribe` hook). A DEAD hand-written `static/sw.js` exists but is OVERWRITTEN by the
  generated SW and never runs (D4 deletes it). `pwa.ts` (utils, not services) does install-prompt +
  `requestBackgroundSync` (Background Sync, not Push) — zero push code.
- **The credential-at-rest pattern** is `user_providers.credentials` AES-256-GCM via `utils/encryption.ts`
  (`PROVIDER_ENCRYPTION_KEY`). But the VAPID keypair is APP-WIDE, not per-user → env secret (D3), like
  `SESSION_SECRET`, NOT a `user_providers` row.
- **No web-push dependency yet** — `web-push` is net-new in `backend/package.json`. Highest migration `0012`
  → the new subscription table is `0013`.
- **The reaping lesson (#135)** — a synced/dead row that is never reaped is unbounded growth; R4 applies it
  to subscriptions (410/404 → prune; failureCount cap → reap).

## §1 — Backend: the subscription store (T1)
New table `push_subscriptions` (schema.ts), migration `0013_push_subscriptions.sql` + journal idx-13:
```
push_subscriptions:
  id            text pk ($defaultFn createId)
  userId        text notNull → users.id (onDelete cascade)
  endpoint      text notNull           // the push-service URL (vendor-specific)
  p256dh        text notNull           // the client public key (base64url)
  auth          text notNull           // the client auth secret (base64url)
  userAgent     text                   // optional, for the user to identify a device in a list
  failureCount  integer notNull default 0
  lastSuccessAt integer (timestamp)
  createdAt     integer (timestamp) $defaultFn now
  index ps_user_idx           on (userId)
  unique index ps_user_endpoint_idx on (userId, endpoint)   // idempotent re-subscribe; never dup
```
A `pushSubscriptionRepository` (mirrors the reminders repo): `upsertByEndpoint(userId, sub)`,
`findByUser(userId)`, `deleteByEndpoint(userId, endpoint)`, `incrementFailure(id)` / `markSuccess(id)`,
`prune(id)`. All methods userId-scoped (the IDOR discipline) — the endpoint alone never authorizes a write.
**NOT backed up (CORRECTED at T1/C556):** the backup-coverage drift guard forces a deliberate decision on
every new schema table (registry OR `EXCLUDED_BY_DESIGN`), and `push_subscriptions` joins `sessions` /
`user_providers` on the EXCLUDED list — the endpoint + p256dh/auth keys are DEVICE-EPHEMERAL secrets
re-derivable by the browser on re-subscribe, and a restored stale subscription would push to a dead endpoint
in a new environment (the `sessions` "meaningless/unsafe to restore" rationale). The user simply re-enables
push per-device after a restore; nothing of value is lost. (The earlier draft assumed the column auto-flows
into the backup — that was wrong; the exclusion is the correct, deterministic follow of the `sessions`
precedent, not a product fork.)

## §2 — Backend: VAPID config + the public-key route (T2)
- `CONFIG.push` (config.ts): `{ vapidPublicKey, vapidPrivateKey, vapidSubject, enabled }` read from env
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); `enabled = !!(public && private && subject)`.
  Unset → `enabled:false` (the feature is OFF; the in-app feed is unchanged).
- `GET /api/v1/push/vapid-public-key` → `{ publicKey }` when enabled, else **503** with a clear
  `PUSH_NOT_CONFIGURED` body (the FE shows "push not configured on this server" — R6).
- A `bun run vapid:gen` script (`web-push generateVAPIDKeys`) prints a fresh keypair + the `.env` lines for
  the self-hoster. Documented in the README/`.env.example` (the `SESSION_SECRET` convention).
- **The private key NEVER leaves the server** (ARCC §7.1) — only the public key is served. Neither is logged.

## §3 — Backend: subscribe/unsubscribe routes (T3)
- `POST /api/v1/push/subscribe` — Zod-validates `{ endpoint, keys:{ p256dh, auth }, userAgent? }`;
  `upsertByEndpoint(ctx.userId, …)`; idempotent (re-subscribe updates the same (userId,endpoint) row,
  resets failureCount). 201/200. SAX-04 input caps (endpoint length-bounded).
- `DELETE /api/v1/push/subscribe` — `{ endpoint }`; `deleteByEndpoint(ctx.userId, endpoint)`. 204.
- Mounted under a new `push` router (`/api/v1/push`), session-authed; the userId is `ctx.userId`, NEVER from
  the body. An IDOR test asserts user A cannot read/delete user B's subscription.

## §4 — Backend: the send-on-create hook + the PushSender DI seam (T4)
- A `PushSender` interface: `send(subscription, payload): Promise<PushResult>` where `PushResult` is
  `{ ok } | { gone } | { transientError }`. The REAL impl wraps `web-push.sendNotification` (maps a 404/410 →
  `gone`, other non-2xx → `transientError`). A FAKE impl (test) records calls + scripts results — the
  zero-network seam (the PhotosClient/VLM-adapter pattern). `setPushSenderForTest(sender|null)` mirrors the
  shipped DI seams.
- `pushService.notifyUser(userId, payload)`: `findByUser` → for each, `send`; on `gone` → `prune`; on
  `transientError` → `incrementFailure` (+ reap past a cap, R4); on `ok` → `markSuccess`. **Best-effort:
  wrapped so it NEVER throws into the caller** (R3) — a `try/catch` that logs status only.
- The hook: in the trigger-service, AFTER a `reminder_notifications` row is inserted (both
  `processNotificationPeriod` time + `processMileageReminder` mileage paths), call
  `pushService.notifyUser(userId, payloadFromReminder(reminder, notification))` — fire-and-forget (do not
  await into the trigger result; or await-and-swallow so a slow push never stalls the sweep). The payload is
  `{ title, body, tag: reminder.id, url: '/reminders' }` — title/body derived from the reminder name + due
  axis (e.g. "Oil change due" / "Due at 60,000 mi"). NO PII beyond the reminder text the user authored.
- Tests: the fake sender asserts `notifyUser` fired with the right payload on a trigger that creates a
  notification; a `gone` result reaps the row; a `transientError` does NOT throw (the trigger still returns
  its normal `TriggerResult`); the in-memory harness runs with `enabled:false`-equivalent (the fake is
  injected, so no real VAPID needed).

## §5 — Frontend: the subscribe client + settings card (T5)
- `push-api.ts` client: `getVapidPublicKey()`, `subscribe(sub)`, `unsubscribe(endpoint)`.
- `push.ts` (utils, beside `pwa.ts`): `isPushSupported()` (feature-detect serviceWorker + PushManager +
  Notification), `getSubscriptionState()`, `enablePush()` (request permission → `reg.pushManager.subscribe(
  { userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array(publicKey) })` → POST), `disablePush()`
  (`sub.unsubscribe()` + DELETE). Uses the `registerSW onRegistered` registration (or
  `navigator.serviceWorker.ready`).
- `PushNotificationsCard.svelte` (settings, beside the LLM/VLM provider cards): a toggle + a status line —
  **not-supported** / **not-configured** (503) / **denied** / **subscribed** / **off**. First-enable
  AlertDialog disclosure (D5: what it does, the request-driven-timing honesty D6, the vendor-push-service
  note, off-anytime). Four-states + a11y + mobile-first. localStorage flag for the disclosure (the R7
  pattern from the assistant/photos cards).

## §6 — Frontend: the service worker push handler (T6 — the gated, eyes-on slice)
- Switch `vite.config.ts` to `SvelteKitPWA({ strategies: 'injectManifest', srcDir: 'src',
  filename: 'service-worker.ts', … })` + author `src/service-worker.ts`:
  - `precacheAndRoute(self.__WB_MANIFEST)` (keep the workbox precache + autoUpdate).
  - `self.addEventListener('push', …)` → `event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/pwa-192x192.png', tag, data:{ url } }))`.
  - `self.addEventListener('notificationclick', …)` → close + focus an existing client or `clients.openWindow(url)`.
- DELETE the dead `static/sw.js` (D4 — scout-confirmed it never runs).
- **This is the highest-risk slice** (the build pipeline + a real PWA install to verify a delivered push) —
  built LAST, gated on T0, eyes-on verified (boot + the settings card render + the SW build emits push
  handlers; the live cross-vendor delivery stays eyes-on-pending like the live-VLM/Photos legs since it needs
  a real installed PWA + a real browser push service).

## §7 — ARCC governance mapping (the credential-surface precondition — CLEARED 2026-06-30)
This feature handles a SERVER CREDENTIAL (the VAPID private key), stores USER PII (push subscriptions —
device endpoints + crypto keys), and ships a service worker. The ARCC governance flow (credentials + user
data + file/SW surface) applies → `search_arcc` ran BEFORE the design opinions.

**ARCC RAN 2026-06-30 (C555, alias angryang, sdlcStage authoring)** — query: "web push notifications, VAPID
keys, service worker, push subscription credentials". The corpus has no dedicated web-push article (it is
AWS-console-centric); the directly-applicable returned guidance + how this design satisfies each control:

1. **Service Credential Isolation (cnt_lTgkGeaTGO5SET / SAX-05 — never expose a service credential to the
   client/untrusted side; scope to least privilege; inject via a secure channel; rotate).** → **Control:**
   the VAPID **private key** is a server-only secret — env-configured (`VAPID_PRIVATE_KEY`, the
   `SESSION_SECRET` convention), NEVER serialized to the browser, NEVER logged (the existing token-handling
   discipline: log status codes, not secrets). Only the VAPID **public key** crosses to the client — that is
   public-by-design (the `applicationServerKey` the browser cryptographically requires; it authorizes
   nothing on its own). The keypair is rotatable (regen + re-subscribe). No service credential reaches
   client-controlled code.
2. **CSP / Web-worker (cnt_TFTi8U2Rvqny0N — a service worker applies CSP from its loading domain; keep CSP
   tight; avoid `unsafe-eval`/`unsafe-inline` beyond style; be careful with `data:`/`blob:`).** →
   **Control:** the push service worker is SAME-ORIGIN (served by VROOM, not a CDN/data:/blob:), so it
   inherits VROOM's CSP. Push DELIVERY flows FROM the browser's push service TO the SW (a browser-internal
   channel) — the SW does NOT `fetch` the push endpoint, so NO new `connect-src` is required for delivery;
   the only same-origin call is the subscribe POST. No `unsafe-eval`/`unsafe-inline` is introduced (the SW is
   a built module, not eval'd). The `injectManifest` SW is a standard built artifact, not dynamically eval'd.
3. **User-PII / least-data handling (general data-protection discipline).** → **Control:** a push
   subscription (endpoint + p256dh + auth) is the user's own device identifier — stored as a userId-scoped
   row, cross-tenant-isolated (IDOR-tested: a user reads/writes/deletes only their own), included in the
   user's backup payload as their data, and NEVER logged. Only the minimum needed (the W3C PushSubscription
   fields + an optional userAgent label) is stored. The push PAYLOAD carries only the reminder text the user
   authored — no additional PII, no analytics beacon.
4. **Least-privilege / opt-in + honest disclosure.** → **Control:** push is OPT-IN (no permission prompt
   auto-fires; requested only on an explicit toggle, D5); a denied permission is respected (no re-nag); the
   feature is OFF when VAPID is unconfigured; the timing limit is disclosed (D6). The narrowest capability
   (`userVisibleOnly:true` — the standard that forbids silent/background push) is requested.
5. **SSRF on the subscribe endpoint (ARCC SSRF-mitigation + SAX-04, searched C560).** → **Control:** the
   subscription `endpoint` is a user-supplied URL the server later POSTs to via web-push — an unvalidated
   one is a blind SSRF (an authed user could store `http://169.254.169.254/…` metadata / a localhost admin
   port). `push-endpoint.ts` `isAllowedPushEndpoint` enforces a STRICT positive allowlist: an https URL, no
   userinfo, host == or a dot-suffixed subdomain of a known browser-vendor push host (fcm.googleapis.com /
   push.services.mozilla.com / push.apple.com / notify.windows.com). Wired at the subscribe route (reject
   → 400 BEFORE storing, the earliest point) AND in the sender (defense-in-depth: a non-allowlisted host is
   treated as `gone` and pruned, never POSTed to). A vendor-domain allowlist is immune to DNS rebinding (a
   string match on non-attacker-controllable domains, no runtime resolution); an IP-literal host never
   matches. Found by an adversarial review of the shipped backend (C560) + fixed same-cycle (commit 778efb5).

**VERDICT: CLEARED to build.** The VAPID private key is a server-only env secret on the SAX-05 isolation
pattern, the SW is same-origin under VROOM's CSP with no new egress, the subscription is a tenant-isolated
user-PII row, and push is opt-in + honestly disclosed. No blocking finding. (A formal TPSM vendor assessment
is an Amazon-internal-production process — N/A to VROOM, a personal self-hosted project where the user is
their own data controller and the browser push service is the user's own chosen browser vendor; recorded for
completeness, not a gate.) All slices are UNBLOCKED on the ARCC axis; the product/architecture forks D1–D6
remain a SEPARATE T0 sign-off.

## §8 — Risk register
1. **Implying guaranteed timing.** Mitigation: D2/D6 — push fires on the existing request-driven trigger;
   the settings copy states "when VROOM runs a reminder check", and a scheduled-nudge background runner is a
   named follow-on spec. No silent over-promise (the data-honesty bar).
2. **The SW collision / a broken PWA build.** Mitigation: D4 — switch to `injectManifest` with one custom
   SW, DELETE the dead `static/sw.js`; the SW slice is built LAST + eyes-on verified (the build emits push
   handlers; the precache still works). Highest-risk → gated + last.
3. **Dead-subscription growth.** Mitigation: R4 — a 404/410 push result prunes the row; a failureCount cap
   reaps a persistently-failing one (the #135 reaping lesson).
4. **Push failing the reminder write.** Mitigation: R3 — `notifyUser` is best-effort, wrapped so it NEVER
   throws into the trigger path + NEVER blocks the sweep; a transport error logs status only; the in-app feed
   is the unaffected baseline.
5. **A VAPID private-key leak.** Mitigation: §7.1 — env-only, never client-shipped, never logged; rotatable.
6. **Permission-prompt fatigue.** Mitigation: D5 — opt-in behind an explicit toggle, never auto-fired; a
   denied permission is respected.
7. **Cross-tenant subscription access (IDOR).** Mitigation: every store method is session-userId-scoped; the
   endpoint never authorizes; an IDOR test pins it.
8. **iOS / unsupported-browser breakage.** Mitigation: R6 — feature-detect + degrade; the in-app `/reminders`
   feed is the baseline channel where push is unavailable; no console error.
9. **SSRF via a crafted subscription endpoint** (found by an adversarial review C560). Mitigation: §7.5 —
   a strict https-only vendor-host allowlist (`isAllowedPushEndpoint`), enforced at the subscribe route
   (reject before storing) + in the sender (defense-in-depth, prune a rogue host). Shipped 778efb5, guarded
   by push-endpoint-ssrf.test.ts.
