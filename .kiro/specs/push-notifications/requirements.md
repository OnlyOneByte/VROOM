# Push Notifications — Requirements

> STATUS: shipped (T0–T6 — see `tasks.md`). The decisions D1–D6 below were accepted and the code was
> built to them; they are recorded as the rationale for what exists, not as open forks. The one thing
> never verified end-to-end is live cross-vendor DELIVERY — that needs a real installed PWA and a real
> browser push service. The named follow-on is a scheduled nudge (see Out of scope).
>
> This feature EXTENDS two shipped systems — the persistent reminder-notification feed
> (`reminder_notifications`, written by the trigger-service) and the installed PWA
> (`@vite-pwa/sveltekit` + a registered service worker). It does not greenfield a notification model.

## Problem
VROOM already fires reminder notifications (mileage + time axis) and persists them
(`reminder_notifications` — userId-scoped, deduped, ordered by `createdAt`) — but they only surface
when the user opens the app and looks at the `/reminders` feed. A maintenance reminder due today, an
insurance term expiring, a recurring expense materialized: none reach the user unless they happen to
open VROOM. For a mobile-first "log a fill-up at the pump" PWA, that is exactly the moment the user is
NOT looking at the app. The whole value of a reminder is a timely nudge.

## Goal
Deliver the EXISTING reminder notifications to the user's device via the **Web Push API** — the
standard, self-hostable, no-third-party-SaaS mechanism — so an installed VROOM can show a system
notification even when the tab is closed. The `reminder_notifications` row stays the source of truth
(one push per newly-created row); this adds only the delivery layer: a per-user subscription store, a
VAPID-signed send, and a service-worker `push`/`notificationclick` handler. Opt-in, privacy-first, and
degradeable — a self-hoster who sets no VAPID keys simply gets the in-app feed unchanged.

## In scope (v1)
- A **per-user push-subscription store** (`push_subscriptions`, migration `0013`): endpoint + p256dh +
  auth keys, userId-scoped, FK-cascade on user delete — the `reminder_notifications` row shape.
- A **subscribe / unsubscribe** flow: a settings opt-in that calls `Notification.requestPermission()` →
  `pushManager.subscribe({ applicationServerKey })` → POSTs the subscription; an unsubscribe that
  revokes it both browser-side and server-side.
- An app-wide **VAPID keypair**: private key is a server secret, public key (`applicationServerKey`) is
  served to the browser. Configured via env, like `SESSION_SECRET`.
- A **send-on-create hook**: when the trigger-service inserts a new `reminder_notifications` row, fire
  a Web Push to that user's subscriptions — best-effort, never blocking or failing the reminder write.
- A **service-worker `push` + `notificationclick` handler**: render the OS notification; on click,
  focus or open VROOM at `/reminders`.
- **Dead-subscription reaping**: a send that returns "gone" (404/410) prunes that row — no unbounded
  growth, no repeated failed sends.

## Out of scope (v1) — explicit cuts
- **A scheduled reminder sweep.** The trigger-service is REQUEST-DRIVEN: it fires on `POST
  /reminders/trigger` and synchronously after an odometer/expense/trip write. v1 pushes on those SAME
  triggers — when something the user does (or a poll) creates a notification, that notification is
  pushed. A true "it's 9am, your insurance expires today, and you haven't opened the app in a week"
  nudge needs a scheduled sweep that does not exist; that is a separate spec (D6 names the boundary).
- **Non-reminder push** (marketing, "your backup finished", sync conflicts). v1 pushes ONLY the
  existing reminder notifications. New push sources are later specs.
- **iOS web-push nuance beyond best-effort.** iOS Safari supports web push only for an installed
  (Add-to-Home-Screen) PWA, 16.4+. v1 feature-detects and degrades (no prompt where unsupported).
- **A native push provider** (FCM/APNs direct, OneSignal). v1 is standard self-hostable VAPID Web Push
  — no third-party SaaS, no Google/Apple account.
- **Rich notifications** (action buttons, images, inline reply). v1 is title + body + click-to-open.
- **A nav bell / unread badge.** The `/reminders` feed already shows unread state.

## Accepted decisions (D1–D6)
- **D1 — Delivery mechanism: standard VAPID Web Push** (the `web-push` library server-side, the browser
  Push API client-side). Self-hostable, no SaaS vendor account. (A SaaS like OneSignal was rejected as
  a privacy/self-hosting violation; email is a different channel and a separate spec.)
- **D2 — Trigger timing: push on the existing request-driven trigger.** When the trigger-service creates
  a `reminder_notifications` row, push it then. Honestly scoped as "you get a push when VROOM next runs
  a reminder check", NOT a guaranteed daily nudge. (Building a scheduler was deferred to its own spec.)
- **D3 — VAPID keys: an env-configured server secret.** The keypair is app-wide, not per-user, so it is
  a deploy secret: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`. Unset → the feature is
  OFF and the in-app feed is unchanged. `bun run vapid:gen` prints a fresh keypair for the self-hoster.
  (Storing it per-user via the `user_providers` encryption seam was rejected: it is server-wide infra.)
- **D4 — Service worker: the `injectManifest` strategy with a custom `src/service-worker.ts`** that adds
  `push` + `notificationclick` on top of the workbox precache, plus deletion of the dead `static/sw.js`
  (which the generated SW overwrote, so it never ran). (A `generateSW` + `importScripts` shim was
  rejected as fragile; hand-rolling the whole SW loses the workbox precache.)
- **D5 — Opt-in placement: a settings card** ("Push Notifications" — a toggle plus a status line:
  not-supported / not-configured / denied / subscribed / off) with a first-enable disclosure. (An inline
  prompt on the reminders page was rejected: a permission prompt must follow an explicit user action.)
- **D6 — Timing honesty: document the request-driven limit** in the settings copy and here. v1 delivers
  "when VROOM runs a check"; a guaranteed scheduled nudge is a named follow-on.

## Functional requirements
- **R1** — A `push_subscriptions` table (additive migration `0013`): `id`, `userId` (FK→users, cascade),
  `endpoint`, `p256dh`, `auth`, `userAgent?`, `createdAt`, `lastSuccessAt?`, `failureCount`, unique on
  `(userId, endpoint)`.
- **R2** — `GET /api/v1/push/vapid-public-key` returns the configured public key, or 503
  `PUSH_NOT_CONFIGURED` when unset. `POST /api/v1/push/subscribe` persists
  `{endpoint, keys:{p256dh,auth}, userAgent?}` for the session user (idempotent on endpoint — a
  re-subscribe updates, never duplicates) and returns the row id only. `DELETE /api/v1/push/subscribe`
  removes it by endpoint (idempotent). All three are session-authed and userId-scoped — the userId is
  NEVER client-supplied, and the endpoint alone never authorizes a read or write.
- **R3** — When the trigger-service creates a `reminder_notifications` row, it emits a Web Push to that
  user's subscriptions via `notifyUser(userId, payload)`. Best-effort: it NEVER throws into the trigger
  path, NEVER blocks the reminder write, and logs status only (never the subscription or its keys).
- **R4** — A send returning 404/410 PRUNES that row; repeated transient failures increment
  `failureCount` and a row past the cap is reaped. The rows ONE user may hold are also capped: a new
  device past the cap evicts their oldest subscription rather than being rejected.
- **R5** — The service worker handles `push` (show a notification: title, body, a PWA icon, and a tag so
  repeated nudges for one reminder collapse) and `notificationclick` (focus an existing VROOM tab or
  open `/reminders`).
- **R6** — Feature-detect and degrade: where serviceWorker/PushManager/Notification is unavailable, or
  VAPID is unconfigured (503), the subscribe UI states the reason and the rest of VROOM is unchanged.
  No console error, no broken state — the in-app `/reminders` feed remains the baseline channel.
- **R7** — Push config must not be needed to run the tests: the send sits behind a `PushSender` DI seam
  so the in-memory HTTP harness injects a fake (zero-network), the same pattern as the injectable
  `PhotosClient`. The store routes test against a real DB; the hook tests assert the fake sender was
  called with the right payload and that a `gone` result reaps the row.

## Safety requirements
- **The VAPID private key is a server secret**: env-only, never shipped to the browser, never logged.
  The public key IS public — it is the `applicationServerKey` the browser needs and authorizes nothing.
- **A push subscription is user PII** (a device endpoint plus crypto keys): a userId-scoped,
  cross-tenant-isolated row, never logged. It is deliberately **NOT backed up** — it sits on the backup
  `EXCLUDED_BY_DESIGN` list beside `sessions`/`user_providers`, because the keys are device-ephemeral
  and re-derivable on re-subscribe, and a restored stale subscription would push to a dead endpoint.
  The user re-enables push per device after a restore.
- **A user-supplied endpoint is an SSRF vector** — the server later POSTs to it. Only an https URL on a
  known browser-vendor push host is accepted, rejected before storing.
- **Opt-in only.** No permission prompt auto-fires; the browser permission is requested only on an
  explicit user toggle. A denied permission is respected (no re-nag).
- **Best-effort delivery, honestly disclosed.** v1 does not promise guaranteed timing; the settings copy
  states the request-driven limit so the user is not misled.
