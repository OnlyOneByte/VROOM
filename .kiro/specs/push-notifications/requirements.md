# Push Notifications — Requirements

> SPEC (C555). TODO #14 "Push notifications". Greenlit-to-spec under Angelo decision-23: the SPEC step is
> pre-authorized; the real product/UX + architecture forks below (D1–D6) gate the dependent build slices on
> a T0 sign-off. This feature builds on TWO shipped systems — the persistent reminder-notification feed
> (`reminder_notifications`, the trigger-service writes it) and the installed PWA (`@vite-pwa/sveltekit` +
> a registered service worker) — so it EXTENDS, it does not greenfield a notification model.

## Problem
VROOM already FIRES reminder notifications (mileage + time axis) and PERSISTS them
(`reminder_notifications`, ordered by `createdAt`, deduped, userId-scoped) — but they only surface when the
user OPENS the app and looks at the `/reminders` feed. A maintenance reminder due today, an insurance term
expiring, a recurring expense materialized — none reach the user unless they happen to open VROOM. For a
"log a fill-up at the pump" mobile-first PWA, that is exactly the moment the user is NOT looking at the app.
The whole value of a reminder is a timely nudge; today there is no nudge, only a feed you must visit.

## Goal
Deliver the EXISTING reminder notifications to the user's device via the **Web Push API** (the standard,
self-hostable, no-third-party-SaaS mechanism a PWA uses) so an installed VROOM can show a system
notification even when the tab is closed. Reuse the shipped `reminder_notifications` row as the
source-of-truth (one push per newly-created notification); add only the delivery layer (a per-user
subscription store + a VAPID-signed send + a service-worker `push`/`notificationclick` handler). Opt-in,
privacy-first, and degradeable (a self-hoster who sets no VAPID keys simply gets the in-app feed unchanged).

## In scope (v1)
- A **per-user push-subscription store** (a new `0013` table): endpoint + p256dh + auth keys, userId-scoped,
  FK-cascade on user delete — the same userId-owned-row shape as `reminder_notifications`.
- A **subscribe / unsubscribe** flow: a settings opt-in that calls `Notification.requestPermission()` →
  `pushManager.subscribe({ applicationServerKey })` → POSTs the subscription to the store; an unsubscribe
  that revokes it both browser-side and server-side.
- A **VAPID keypair** (the Web Push application-server identity): private key is a SERVER SECRET, public key
  (`applicationServerKey`) is served to the browser. Generated once; configured via env (the
  `PROVIDER_ENCRYPTION_KEY`/`SESSION_SECRET` env convention).
- A **send-on-create hook**: when the trigger-service inserts a new `reminder_notifications` row, fire a
  Web Push to that user's active subscriptions (best-effort, never blocking the trigger, never failing the
  reminder write).
- A **service-worker `push` + `notificationclick` handler**: render the OS notification; on click, focus/open
  VROOM at `/reminders`. This requires resolving the existing SW situation (D4 — the live SW is workbox-
  `generateSW`-generated with no push handlers; there is also a dead `static/sw.js`).
- **410/404 subscription reaping**: a push send that returns "gone" (the browser dropped the subscription)
  prunes that row — no unbounded dead-subscription growth, no repeated failed sends.

## Out of scope (v1) — explicit cuts
- **A background SCHEDULER / cron.** The trigger-service is REQUEST-DRIVEN today (fires on login/poll +
  synchronously after an odometer/expense write). v1 pushes on the SAME triggers — i.e. when something the
  user does (or a poll) creates a notification, that notification is pushed. A true time-based "it's 9am,
  your insurance expires today, and you haven't opened the app in a week" scheduled sweep needs a background
  job runner that DOES NOT EXIST (scout-confirmed) — that is a separate infra spec (D6 names the boundary).
- **Non-reminder push** (marketing, "your backup finished", sync conflicts). v1 pushes ONLY the existing
  reminder notifications — the shipped, deduped, userId-scoped source. New push sources are later specs.
- **iOS web-push nuance beyond best-effort.** iOS Safari supports web push ONLY for an installed
  (Add-to-Home-Screen) PWA, 16.4+. v1 feature-detects and degrades gracefully (no permission prompt where
  unsupported); it does not special-case iOS quirks beyond that.
- **A native push provider (FCM/APNs direct, OneSignal, etc.).** v1 is standard self-hostable VAPID Web
  Push — no third-party SaaS, no Google/Apple account, matching NORTH_STAR "no SaaS silo, self-hostable".
- **Rich notifications** (action buttons, images, inline reply). v1 is a title + body + a click-to-open.
- **A global in-app bell/unread badge in the nav.** The `/reminders` feed already shows the unread state;
  v1 does not add a nav bell (a separate UI polish item if wanted).

## Product / UX + ARCHITECTURE decisions (T0 gates these — each has a RECOMMENDED option; ACK takes it)
- **D1 — Delivery mechanism.** RECOMMEND **standard VAPID Web Push** (the `web-push` npm library server-side,
  the browser Push API client-side) — self-hostable, no third-party SaaS, works on Chromium/Firefox + iOS16.4+
  installed PWAs. (Alt: a SaaS like OneSignal — rejected, violates the self-hostable/privacy-first NORTH_STAR
  and adds a vendor account dependency. Alt: email — a different channel, separate spec.)
- **D2 — Trigger timing (the central scope fork).** RECOMMEND **push on the existing request-driven trigger**
  — when the trigger-service creates a new `reminder_notifications` row (login/poll sweep + post-odometer/
  expense recheck), push it then. Honestly scoped: "you get a push when VROOM next runs a reminder check",
  NOT "a guaranteed 9am daily nudge". (Alt: build a background scheduler now — rejected for v1, it is a
  separate infra concern with its own design [a Bun cron / a system timer hitting `/trigger`]; D6 records the
  boundary so we do not silently imply guaranteed timing.)
- **D3 — VAPID key provisioning.** RECOMMEND **env-configured server secret** — the VAPID keypair is
  app-wide (NOT per-user), so it is a deploy secret like `SESSION_SECRET`: `VAPID_PUBLIC_KEY` +
  `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (a mailto:). If unset, the feature is OFF (the in-app feed is
  unchanged) and the subscribe UI shows "push not configured on this server". A `bun run vapid:gen` helper
  prints a fresh keypair for the self-hoster. (Alt: store in the DB via the `user_providers` encryption seam
  — rejected: the keypair is server-wide infra, not a per-user credential; env matches `SESSION_SECRET`.)
- **D4 — Service-worker strategy (resolve the SW collision).** RECOMMEND switch `@vite-pwa/sveltekit` to the
  **`injectManifest` strategy with a custom `src/service-worker.ts`** that adds `push` + `notificationclick`
  handlers on top of the workbox precache, and DELETE the dead `static/sw.js` (scout-confirmed it is
  overwritten by the generated SW and never runs). (Alt: keep `generateSW` and add an importScripts shim —
  rejected, fragile + still leaves the dead file. Alt: hand-roll the whole SW — rejected, loses workbox
  precache.) This is the highest-risk slice (eyes-on + a real PWA install to verify) — gated, built last.
- **D5 — Opt-in placement + disclosure.** RECOMMEND a **settings card** ("Push Notifications" — a permission
  toggle + status: not-supported / not-configured / denied / subscribed) with a first-enable disclosure
  ("VROOM will send a system notification when a reminder is due; you can turn this off anytime; the push
  goes through your browser vendor's push service"). (Alt: an inline prompt on the reminders page — rejected,
  permission prompts are best gated behind an explicit user action, never auto-fired on page load.)
- **D6 — Guaranteed-timing boundary (honesty fork).** RECOMMEND **document the request-driven limit
  explicitly** in the settings copy + the spec — v1 delivers "when VROOM runs a check", and a guaranteed
  scheduled nudge is a named follow-on (a background-trigger infra spec). (Alt: silently ship request-driven
  and let users assume daily nudges — rejected, that is a data-honesty violation of the "no silent" bar.)

## Functional requirements
- **R1** — A new `push_subscriptions` table (migration `0013`, additive — NOT a rebuild): `id`, `userId`
  (FK→users, onDelete cascade), `endpoint` (unique-per-user), `p256dh`, `auth`, `userAgent?`, `createdAt`,
  `lastSuccessAt?`, `failureCount`. UserId-scoped exactly like `reminder_notifications`.
- **R2** — `GET /push/vapid-public-key` returns the configured public key (or a 503/clear "not configured"
  when unset). `POST /push/subscribe` persists a `{endpoint, keys:{p256dh,auth}}` for the session user
  (idempotent on endpoint — re-subscribe updates, never duplicates). `DELETE /push/subscribe` (or
  `/unsubscribe`) removes it. All three are session-userId-scoped — the userId is NEVER client-supplied.
- **R3** — When the trigger-service creates a `reminder_notifications` row, it emits a Web Push to that
  user's subscriptions via a thin `pushService.notifyUser(userId, payload)` seam. The send is best-effort:
  it NEVER throws into the trigger path, NEVER blocks the reminder write, and a transport error is logged
  (status only, never the subscription/keys) — the in-app feed is unaffected if push fails.
- **R4** — A push send returning 404/410 ("gone") PRUNES that subscription row; repeated transient failures
  increment `failureCount` and a row past a cap is reaped (no unbounded dead-subscription growth — the #135
  reaping-hygiene lesson applied to subscriptions).
- **R5** — The service worker handles `push` (show a notification: title from the reminder, body, an icon
  from the existing PWA assets, a tag so repeated nudges collapse) and `notificationclick` (focus an existing
  VROOM tab or open `/reminders`).
- **R6** — Feature-detect + degrade: where Push/Notification/serviceWorker is unavailable (or VAPID is
  unconfigured), the subscribe UI shows the reason and the rest of VROOM is unchanged. No console error, no
  broken state — the in-app `/reminders` feed remains the baseline channel.
- **R7** — The VAPID keypair config does NOT affect the test suite: the push send is behind a DI seam (a
  `PushSender` interface) so the in-memory HTTP harness injects a fake (zero-network), exactly like the
  `PhotosClient`/VLM-adapter test seams. The subscribe/store routes test against the real DB; the send hook
  tests assert the fake sender was called with the right payload + that a 410 reaps the row.

## Non-functional / safety
- **VAPID private key = a server secret** (ARCC SAX-05 credential-isolation): env-only, never shipped to the
  browser, never logged. The public key IS public (it is the `applicationServerKey` the browser needs).
- **A push subscription is user PII** (a device endpoint + crypto keys identifying the user's browser): it is
  a userId-scoped row, cross-tenant-isolated (a user can only read/write/delete their OWN subscriptions —
  the IDOR discipline), in the backup payload as the user's own data, and never logged.
- **The service worker is same-origin**; CSP stays tight (no new `connect-src` for delivery — the browser
  push service delivers TO the SW; the SW does not fetch it). The subscribe endpoint is same-origin.
- **Opt-in only.** No permission prompt auto-fires; the browser permission is requested ONLY on an explicit
  user toggle (D5). A denied permission is respected (no re-nag).
- **Best-effort delivery, honestly disclosed** (D6): v1 does not promise guaranteed timing; the copy states
  the request-driven limit so the user is not misled (NORTH_STAR "no silent" / data-honesty bar).
