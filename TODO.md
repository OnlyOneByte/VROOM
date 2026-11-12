# VROOM — TODO

## In flight

- [ ] **Calendar integration** — greenlit, needs a spec.

## Open — features

- [ ] **Admin page** — instance dashboard (expense/user/vehicle counts); remove or block a user.
- [ ] **Guided setup tour** — walk a new user through storage setup, since photos silently do
  nothing until image storage is configured.
- [ ] **Household view** — aggregate costs across shared vehicles. Builds on vehicle sharing.
- [ ] **Shareable year-end summary** — exportable image or link.
- [ ] **Anonymous cost benchmarks** — opt-in comparison against similar vehicles.
- [ ] **Multi-app CSV import** — the column-mapping layer ships with Fuelio, Fuelly, and Drivvo
  presets (Settings → Migrate from another tracker). A Simply Auto preset remains.
- [ ] **Offline edit and delete** — plus an IndexedDB outbox (the queue is `localStorage`
  today) and an offline navigation fallback (assets already precache). Deferred from offline
  entries v1, which is create-only.
- [ ] **Pluggable SQL backend** — bring-your-own Postgres instead of SQLite.
- [ ] **Non-VLM receipt OCR** — only if a VLM-free path is wanted.
- [ ] **i18n.**

## Open — polish

- [ ] Include photos in the backup ZIP. Backups are data-only today, and the settings UI says so.
- [ ] Logo and icon assets for the login page.
- [ ] PWA install screenshots (narrow ~1080×1920, wide ~1920×1080) — must be hand-made.
- [ ] Loading animation on first open.

## Standing goals

- [ ] **90% test coverage both sides.** The README badges carry the last published
  measurement. The remaining gap is structural (DI-bound singletons, OAuth network paths,
  eyes-on UI), so it needs real new coverage from new features — do not manufacture tests
  that re-implement the logic they claim to cover.
- [ ] **Broaden the E2E suite.** Known gaps are listed in `frontend/e2e/README.md`.

## Someday — scaling

- [ ] Redis-backed rate limiting and idempotency for multi-instance deployments.
- [ ] Repository singletons capture `getDb()` at module scope. If more are added, move to lazy
  init or constructor injection throughout.
