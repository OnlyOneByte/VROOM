# VROOM — TODO

## In flight

- [~] **Push notifications** — T1–T5 shipped; the service-worker `injectManifest` step (T6)
  remains. Spec: `.kiro/specs/push-notifications/`.
- [ ] **Calendar integration** — greenlit, needs a spec. Next after push notifications.

## Shipped

OAuth provider abstraction · PWA asset generator · performant DB schema · reminders and
recurring expenses (backend + frontend) · insurance and financing payments on
`source_id`/`source_type` · odometer entry photos · offline entries (create-only, idempotent)
· vehicle sharing · Google Photos storage provider · VLM receipt parsing · LLM assistant
(read-only v1) · trips and expense location · Google Photos → auto-add expenses.

## Open — features

- [ ] **Admin page** — instance dashboard (expense/user/vehicle counts); remove or block a user.
- [ ] **Guided setup tour** — walk a new user through storage setup, since photos silently do
  nothing until image storage is configured.
- [ ] **Household view** — aggregate costs across shared vehicles. Builds on vehicle sharing.
- [ ] **Shareable year-end summary** — exportable image or link.
- [ ] **Anonymous cost benchmarks** — opt-in comparison against similar vehicles.
- [ ] **Multi-app CSV import** — per-app column mapping for Fuelly, Fuelio, Drivvo, Simply
  Auto. The VROOM-CSV round-trip importer already ships; this is the mapping layer.
- [ ] **Offline edit and delete** — plus an IndexedDB outbox and app-shell caching. Deferred
  from offline entries v1, which is create-only.
- [ ] **Pluggable SQL backend** — bring-your-own Postgres instead of SQLite.
- [ ] **Non-VLM receipt OCR** — only if a VLM-free path is wanted.
- [ ] **i18n.**

## Open — polish

- [ ] Wire the real ZIP path for photo backups; the toggle is a placeholder today.
- [ ] Backup versioning.
- [ ] Logo and icon assets for the login page.
- [ ] PWA install screenshots (narrow ~1080×1920, wide ~1920×1080) — must be hand-made.
- [ ] Loading animation on first open.

## Standing goals

- [ ] **90% test coverage both sides.** Currently ~90% backend / ~89% frontend. The remaining
  gap is structural (DI-bound singletons, OAuth network paths, eyes-on UI), so it needs real
  new coverage from new features — do not manufacture tests that re-implement the logic they
  claim to cover.
- [ ] **Broaden the E2E suite.** Committed specs only; anything uncommitted vanishes on merge.
- [ ] **Fix the timezone-dependent unit tests.** Five frontend tests pass only under `TZ=UTC`.

## Someday — scaling

- [ ] Redis-backed rate limiting and idempotency for multi-instance deployments.
- [ ] Repository singletons capture `getDb()` at module scope. If more are added, move to lazy
  init or constructor injection throughout.
