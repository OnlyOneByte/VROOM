# Push Notifications — Design

> Built backend-first: subscription store → VAPID config + public-key route → subscribe/unsubscribe
> routes → send + trigger hook → frontend client + settings card → service worker. All of it has
> shipped; this document describes what exists and why. See `requirements.md` for the accepted
> decisions D1–D6 that each choice follows.
>
> Two facts the design rides on. (1) The notification source-of-truth already existed:
> `reminder_notifications` (userId-FK, `dueDate` XOR `dueOdometer`, `isRead`, ordered
> `desc(createdAt)`, deduped by a unique `(reminderId, dueDate)` index plus a partial-unique
> `(reminderId, dueOdometer)` index for the mileage axis). Push rides that row — one push per newly
> inserted notification, no new notification model. (2) The reminder trigger is REQUEST-DRIVEN:
> `POST /reminders/trigger` (the full sweep) plus `recheckMileageReminders` called synchronously from
> the odometer/expense/trip write paths. Nothing schedules it. A guaranteed-time daily nudge would
> need a scheduled sweep — the in-process `setInterval` worker in `api/providers/sync-worker.ts` is
> the precedent for how one would be built, but no such sweep exists for reminders.

## §1 — The subscription store
`push_subscriptions` (`db/schema.ts`, migration `0013_push_subscriptions.sql`, journal idx 13): `id`
(cuid2 pk), `userId` (FK→users, cascade), `endpoint`, `p256dh`, `auth`, `userAgent?`, `failureCount`
(default 0), `lastSuccessAt?`, `createdAt`; index `ps_user_idx` on `(userId)` and unique index
`ps_user_endpoint_idx` on `(userId, endpoint)` so a re-subscribing browser upserts instead of
duplicating.

`pushSubscriptionRepository` (`api/push/repository.ts`): `upsertByEndpoint` (onConflictDoUpdate on
`(userId, endpoint)` — refreshes the keys and resets `failureCount`), `findByUser`,
`deleteByEndpoint`, `markSuccess`, `incrementFailure`, `prune`. Every method is userId-scoped; the
endpoint alone never authorizes a write. `upsertByEndpoint` also enforces
`CONFIG.validation.push.maxSubscriptionsPerUser` by evicting the user's OLDEST surplus rows — device
rotation is normal, so a legitimate new phone must not be rejected, and the cap bounds a
crafted-endpoint flood.

**Deliberately NOT backed up.** The table sits on the backup suite's `EXCLUDED_BY_DESIGN` list beside
`sessions`/`user_providers`: the endpoint and keys are device-ephemeral secrets the browser
re-derives on re-subscribe, and a restored stale subscription would push to a dead endpoint. (The
backup-coverage drift guard forces this decision explicitly for every new schema table.)

## §2 — VAPID config + the public-key route
- `CONFIG.push` (`config.ts`): `{ vapidPublicKey, vapidPrivateKey, vapidSubject, enabled }` read from
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`; `enabled` is true only when all three
  are set. Unset → the feature is OFF and the in-app feed is unchanged.
- `GET /api/v1/push/vapid-public-key` (session-authed) → `{ publicKey }` when enabled, else **503**
  `PUSH_NOT_CONFIGURED` so the frontend can report the reason honestly rather than fail opaquely.
- `bun run vapid:gen` (`src/scripts/gen-vapid-keys.ts`) prints a fresh keypair plus the `.env` lines;
  `.env.example` documents the three vars as optional.
- The private key never leaves the server — no route returns it, nothing logs it.

## §3 — Subscribe / unsubscribe routes
Both live on the `push` router (`api/push/routes.ts`, mounted at `/api/v1/push` with `requireAuth`).
Neither is gated on `CONFIG.push.enabled`: a browser may register regardless of whether this server
can currently send, and the send path checks enablement itself.
- `POST /subscribe` — Zod-validates `{ endpoint, keys:{p256dh,auth}, userAgent? }` with input caps
  (endpoint 2000 chars, keys 512, userAgent 512), rejects a disallowed endpoint host with a 400
  (§7.3), then `upsertByEndpoint(ctx.userId, …)`. Returns **201 `{ id }`** — the crypto keys are never
  echoed back.
- `DELETE /subscribe` — `{ endpoint }` → `deleteByEndpoint(ctx.userId, endpoint)`, returning
  **`{ removed }`**. Idempotent: an unknown or another user's endpoint is a clean no-op, not an error.
- The userId is always `ctx.userId`, never the body.

## §4 — The send, the `PushSender` seam, and the trigger hook
`api/push/push-service.ts`:
- `PushSender` is `send(subscription, payload) => Promise<PushResult>`, where `PushResult` is a
  discriminated `{ kind: 'ok' | 'gone' | 'transientError' }`. The real `webPushSender` wraps
  `web-push.sendNotification` (VAPID details set once; a `WebPushError` 404/410 → `gone`, anything
  else → `transientError`). `setPushSenderForTest(sender | null)` is the DI seam a test fake uses.
- `notifyUser(userId, payload)` fans out over `findByUser` and applies the reaping lifecycle per
  result: `ok` → `markSuccess`; `gone` → `prune`; `transientError` → `incrementFailure`, and `prune`
  once the count reaches `CONFIG.validation.push.maxConsecutiveFailures`. It returns a small
  `{ sent, pruned, failed }` summary and is **best-effort**: a per-subscription error cannot abort the
  fan-out, and the whole call is wrapped so it never throws into its caller. When the real sender is
  active but no VAPID keypair is configured it returns immediately without touching `failureCount` — a
  config gap is not a failed send.
- The hook (`api/reminders/trigger-service.ts`): after a `reminder_notifications` row is inserted on
  BOTH the time path and the mileage path, `firePushForNotification(reminder, created)` calls
  `notifyUser`. `payloadFromReminder` reads the axis off the row rather than guessing:
  `{ title: '<name> due', body: dueOdometer !== null ? 'Due at <n> mi' : 'This reminder is now due',
  tag: reminder.id, url: '/reminders' }`. The call is awaited and swallowed, so a slow or failing push
  can neither fail nor stall the sweep. No PII beyond the reminder name the user authored.

## §5 — Frontend: the client, the utils, and the settings card
- `lib/services/push-api.ts` — `pushApi.getVapidPublicKey()` / `.subscribe(input)` /
  `.unsubscribe(endpoint)` over the shared `apiClient`. Transport only; it never touches the browser
  Push API. The 503 surfaces as an `ApiError` with `code === 'PUSH_NOT_CONFIGURED'`.
- `lib/utils/push.ts` (beside `pwa.ts`) — `isPushSupported()`, `getNotificationPermission()`,
  `urlBase64ToUint8Array()`, `getExistingSubscription()`, `enablePush()` (request permission → fetch
  the public key → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → POST,
  returning a discriminated `PushEnableOutcome`), `disablePush()` (`sub.unsubscribe()` + DELETE), and
  the pure `derivePushStatus` / `pushStatusLabel` state machine. `getExistingSubscription` uses
  `serviceWorker.getRegistration()`, NOT `.ready` — `.ready` never resolves when no SW is registered
  (dev), which would hang the card's loading spinner.
- `lib/components/settings/cards/PushNotificationsCard.svelte` — a Switch plus a status line
  (not-supported / not-configured / denied / subscribed / off). Turning it ON first opens the
  disclosure AlertDialog (what push does, the request-driven timing limit, that delivery goes through
  the browser vendor's push service, that it can be turned off anytime); the browser permission prompt
  fires only after that acknowledgement. The acknowledgement is remembered in `localStorage` under
  `vroom.push.disclosed`; turning the toggle off is immediate.

## §6 — The service worker
`vite.config.ts` runs `SvelteKitPWA({ strategies: 'injectManifest', srcDir: 'src', filename:
'service-worker.ts', registerType: 'autoUpdate', injectManifest: { globPatterns: [...] }, manifest })`,
and `src/service-worker.ts`:
- `precacheAndRoute(self.__WB_MANIFEST)` plus `skipWaiting()` / `clientsClaim()` — `injectManifest`
  means we wire the precache and the autoUpdate behavior ourselves.
- a `push` listener → `showNotification(title, { body, icon: '/pwa-192x192.png', tag, data:{url} })`,
  reading the §4 payload defensively so a bodyless or non-JSON push still surfaces a generic
  notification instead of being dropped.
- a `notificationclick` listener → close, then focus and navigate an existing window client, else
  `clients.openWindow(url)`.

Two build constraints, both load-bearing: the file MUST be named `service-worker.ts` (SvelteKit's
reserved SW entry — `@vite-pwa/sveltekit`'s injectManifest step reads SvelteKit's compiled
`output/client/service-worker.js`), and `self.__WB_MANIFEST` must appear verbatim rather than via an
alias, because workbox substitutes it by string match on the built output. The dead `static/sw.js` is
deleted — two registered service workers would collide.

## §7 — Security controls
1. **The VAPID private key is a server credential.** Env-configured, never serialized to the browser,
   never logged (log status codes, not secrets). Only the public key crosses to the client, which is
   public by design — it is the `applicationServerKey` the browser cryptographically requires and it
   authorizes nothing on its own. The keypair is rotatable (regenerate, then users re-subscribe).
2. **The service worker is same-origin**, so it inherits VROOM's CSP, and it introduces no new egress:
   push delivery flows from the browser's push service TO the SW over a browser-internal channel, so
   the SW never fetches the push endpoint and no new `connect-src` is needed. The only same-origin
   call is the subscribe POST. The SW is a built module, not eval'd.
3. **SSRF on the subscribe endpoint.** The `endpoint` is a user-supplied URL the server later POSTs to,
   so an unvalidated one is a blind SSRF (an authed user could store an instance-metadata address or a
   localhost admin port). `api/push/push-endpoint.ts` `isAllowedPushEndpoint` enforces a strict
   positive allowlist: an https URL, no userinfo, and a host that equals or is a dot-suffixed subdomain
   of a known browser-vendor push host (`ALLOWED_PUSH_HOSTS`: fcm.googleapis.com,
   push.services.mozilla.com, push.apple.com, notify.windows.com). It runs at the subscribe route
   (reject before storing) AND in the sender (defense in depth — a non-allowlisted host is treated as
   `gone` and pruned, never POSTed to). A vendor-domain allowlist is immune to DNS rebinding (a string
   match on non-attacker-controllable domains, no runtime resolution), and an IP-literal host — the
   actual SSRF vector — can never match one.
4. **Subscriptions are tenant-isolated user PII.** Each row is userId-scoped, readable/writable/
   deletable only by its owner, never logged, and excluded from backups (§1). Only the W3C
   PushSubscription fields plus an optional userAgent label are stored, and the payload carries only
   the reminder text the user authored — no analytics beacon.
5. **Least privilege and opt-in.** `userVisibleOnly: true` is requested (the standard forbids silent
   background push). No prompt auto-fires; a denied permission is respected; the feature is off when
   VAPID is unconfigured; the timing limit is disclosed in the UI.

## §8 — Risks and their mitigations
1. **Implying guaranteed timing** → push fires on the existing request-driven trigger and the settings
   copy says so; a scheduled nudge is a named follow-on, not a silent promise.
2. **A broken PWA build from the SW switch** → one custom SW under `injectManifest`, the dead
   `static/sw.js` deleted, and a guard test that source-scans for the handlers, the vite wiring, and
   the absence of `static/sw.js`.
3. **Dead-subscription growth** → 404/410 prunes, a failure cap reaps, and a per-user row cap evicts
   the oldest.
4. **Push failing a reminder write** → `notifyUser` never throws into the trigger path and never
   blocks it; the in-app feed is the unaffected baseline.
5. **A VAPID private-key leak** → env-only, never client-shipped, never logged, rotatable.
6. **Permission-prompt fatigue** → opt-in behind an explicit toggle plus the disclosure gate.
7. **Cross-tenant subscription access (IDOR)** → every store method is session-userId-scoped and the
   endpoint never authorizes.
8. **Unsupported browsers / iOS** → feature-detect and degrade; the `/reminders` feed is the baseline.
9. **SSRF via a crafted endpoint** → the §7.3 host allowlist, enforced at both the route and the sender.

Risks 1–9 are mitigated in the shipped code; live cross-vendor DELIVERY remains the one unverified
leg, since it needs a real installed PWA and a real browser push service.
