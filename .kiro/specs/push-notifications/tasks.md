# Push Notifications — Tasks

> All tasks are complete and merged. Built backend-first, one task at a time; see `design.md` for how
> each piece works and `requirements.md` for the decisions D1–D6 they follow. Validate a change to any
> of it with `bun run validate` (backend) / `npm run validate` (frontend).

## Phase 0 — decisions
- [x] **T0 — D1–D6 accepted, all as recommended** (spelled out in `requirements.md`). They gated the
      fork-dependent slices: the trigger hook (D2), the settings card (D5), and the SW switch (D4).
      T1–T3 are additive plumbing and were fork-free.

## Phase 1 — backend store, config, routes
- [x] **T1 — `push_subscriptions` + migration `0013` + the repository.** Schema, the additive
      `CREATE TABLE` migration and journal entry, and `pushSubscriptionRepository` (design §1). Guard:
      `api/push/__tests__/push-subscription-repository.test.ts` drives the real repo against a fresh
      in-memory DB built from the actual migration chain, so it also proves `0013` applies — round
      trip, idempotent re-subscribe, many devices per user, userId-scoped reads, the delete-IDOR case,
      the reap lifecycle, the user-delete cascade, and the per-user cap (a flood is bounded, a new
      device evicts the oldest, a re-subscribe at the cap updates in place). Ripple: the
      backup-coverage drift guard forced a decision for the new table, and it went to
      `EXCLUDED_BY_DESIGN` (design §1) — correcting the draft design, which had assumed it would flow
      into backups.
- [x] **T2 — VAPID config, the public-key route, the `web-push` dep, and `vapid:gen`.** `CONFIG.push`,
      `GET /api/v1/push/vapid-public-key` on the new `push` router, and `bun run vapid:gen`. Guard:
      `api/push/__tests__/vapid-public-key-route.test.ts` — unconfigured → 503 (the harness sets no
      VAPID env, and `CONFIG` is a process-cached snapshot, so it naturally exercises the OFF path that
      is the default deployment state), anon → 401, plus a source-scan invariant that the route never
      reads the private key while it does serve the public one.
- [x] **T3 — subscribe / unsubscribe routes** (design §3). Guard:
      `api/push/__tests__/subscribe-routes.test.ts` over the HTTP harness with a second minted user —
      POST persists and reads back (201, id only, keys not echoed), POST is idempotent, anon → 401,
      malformed body → 400, DELETE removes and is an idempotent no-op, user B cannot delete user A's
      endpoint, and the same endpoint string is per-user.

## Phase 2 — backend send
- [x] **T4a — the `PushSender` seam and `pushService.notifyUser`** (design §4). Guard:
      `api/push/__tests__/push-service.test.ts` — ok / gone / transient / cap-reap, the many-device
      fan-out summary, best-effort swallow (a throwing sender does not abort the fan-out), and scope.
- [x] **T4b — the trigger-service hook** on both the time and mileage notification paths (design §4).
      Guard: `api/reminders/__tests__/trigger-push-hook.test.ts` over the real trigger endpoint with
      the T4a fake sender — a time notification fires the reminder-derived payload, a mileage
      notification fires the `Due at 60,000 mi` body, a throwing sender still leaves the trigger at 200
      with the notification row written (the best-effort proof, non-vacuous), and nothing-due fires no
      push.
- [x] **Hardening — the SSRF endpoint allowlist** (design §7.3), found by an adversarial review of the
      shipped backend. `api/push/push-endpoint.ts` `isAllowedPushEndpoint`, enforced at the subscribe
      route and again in the sender. Guard: `api/push/__tests__/push-endpoint-ssrf.test.ts`.

## Phase 3 — frontend
- [x] **T5 — the push client, the `push.ts` utils, and the settings card** (design §5). Guards:
      `lib/services/__tests__/push-api.test.ts` (exact endpoints and payloads, including the DELETE
      body) and `lib/utils/__tests__/push.test.ts` (the pure state machine's precedence and its honest
      labels). Verified by eye: the card renders the `off` state, and clicking the toggle opens the
      disclosure dialog with the request-driven-timing copy WITHOUT firing the browser permission
      prompt; no console errors.
- [x] **T6 — the service worker and the `injectManifest` switch** (design §6), including deleting the
      dead `static/sw.js`. Guard: `lib/utils/__tests__/sw-push-handlers.test.ts` source-scans the SW
      for the push / notificationclick / precache handlers, checks the vite injectManifest wiring, and
      asserts `static/sw.js` stays deleted. The build was confirmed to emit the handlers and to
      substitute `self.__WB_MANIFEST` with real precache URLs. Verified by eye: the app boots cleanly
      under `injectManifest` and the settings card renders, with no console errors.

## Remaining
- **Live cross-vendor delivery is unverified.** Everything up to the push leaving the server is tested,
  but an actual notification arriving on a device needs a real installed PWA and a real browser push
  service (Chrome/FCM, Firefox, Safari 16.4+ installed). Worth doing once on real hardware.
- **A scheduled nudge is a separate spec.** v1 delivers a push when VROOM runs a reminder check
  (request-driven); it does not promise a guaranteed daily nudge, and the settings copy says so. Do not
  silently imply guaranteed timing.
