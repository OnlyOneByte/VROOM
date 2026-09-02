# VROOM Car Tracker - TODO

> **Trimmed 2026-09-02 (~C964).** The full historical TODO (375 lines — every completed milestone
> checklist + the 2026-06-05 audit prose) is archived verbatim at `loop/archive/TODO-C1-C964.md`. This
> file now carries only the ranked queue (statuses true to the loop) + genuinely-OPEN work. The live build
> plan is `loop/BACKLOG.md`; this is the human priority doc.

## Ranked Priority Queue (Angelo)

1. [x] OAuth abstraction (login provider)
2. [x] PWA asset generator
3. [x] Update DB schema to be more performant
4. [x] Reminders/Recurring feature (backend)
5. [x] Reminders/recurring feature (frontend)
6. [x] Move insurance, finance-payments to source_id/source_type system
7. [x] Odometer entry photos
8. [x] Offline entries (create-only; idempotency closed end-to-end)
9. [x] Sharing between people — SHIPPED as vehicle-sharing (T0–T14, C477)
10. [x] Google Photos storage provider (backend + FE; live-creds connect path is the only untested leg)
11. [x] VLM Provider (receipt parsing) — SHIPPED C527
12. [x] LLM Provider (assistant) — SHIPPED C542 (v1 read-only)
13. [x] Location integration — SHIPPED (trips-location + expense-location C554)
14. [~] Push Notifications — IN FLIGHT (T1–T5 shipped; T6 SW/injectManifest remains). See BACKLOG.
15. [ ] Calendar integration — GREENLIT-TO-SPEC (next after push #14)
16. [x] Pull from Google Photos → auto-add expenses — SHIPPED C547

## Open — features / larger scope
- [ ] **Admin / Management page** — overall dashboard (expense/user/car counts); delete/remove/block user.
- [ ] **Guided setup tour** — walk a new user through storage setup; notify that image storage must be
  configured in settings before photos work.
- [ ] Household view — aggregate costs across shared vehicles (builds on vehicle-sharing).
- [ ] Shareable year-end summary (exportable image or link) — big; ~a full day.
- [ ] Anonymous cost benchmarks — opt-in aggregated comparison vs similar vehicles.
- [ ] Broad multi-app CSV importer (Fuelly/Fuelio/Drivvo/Simply Auto/… column mapping) — the VROOM-CSV
  round-trip importer shipped; the per-app mapping layer is the deferred larger scope.
- [ ] Offline edit/delete + IndexedDB outbox + offline app-shell caching (deferred from offline-entries v1).
- [ ] Abstract out SQLite backend entirely — bring-your-own SQL (Postgres/NoSQL).
- [ ] Receipt/invoice OCR auto-fill beyond the VLM path (if a non-VLM path is wanted).
- [ ] i18n internationalization.

## Open — smaller / polish
- [ ] Backup photos with ZIP (functionality) — the toggle/placeholder exists; wire the real ZIP path.
- [ ] Backup versioning.
- [ ] New logo/icon assets for the auth/login page.
- [ ] (Optional) PWA install screenshots (narrow ~1080×1920 + wide ~1920×1080) — not tool-generated.
- [ ] First-open car-zooming-past-screen loading animation (idea).

## Standing goals
- [ ] **Test coverage → 90% both sides.** Baseline ~90.8% BE / ~89.7% FE (C560). Structural ceiling reached;
  further movement needs new feature SOURCE — do NOT manufacture coverage theater (C181/C229).
- [ ] E2E Playwright tests — broaden the committed source-scan/HTTP guard net (untracked e2e vanish on merge).

### Scaling concerns (someday)
- [ ] Redis for rate-limiting / idempotency in multi-instance deployments.
- [ ] Other backend storage (Postgres/NoSQL).
- [ ] Singleton repositories capture `getDb()` at module scope — consider lazy init / DI if adding more.
