---
inclusion: fileMatch
fileMatchPattern: "backend/src/api/providers/**,backend/src/test-helpers/fake-google-clients.ts,backend/src/api/sync/backup-strategy*.ts,backend/src/api/sync/restore.ts"
---

# Testing External APIs — inject a client, don't `mock.module`

VROOM talks to third-party APIs (Google Drive, Google Sheets, S3; soon Google
Photos, a VLM for receipts, an LLM assistant). Tests must NEVER hit a real one:
no network, no credentials, deterministic. This doc is the standard pattern for
getting there — and the trap to avoid.

## The trap: `mock.module` leaks across files

Bun's `mock.module(specifier, factory)` is **process-global and permanent for the
run**. `bunfig.toml` sets `concurrency = 1`, so every test file shares one process
— a `mock.module('../services/google-drive-service', …)` registered in file A
replaces that module in files B, C, D too. We learned this the expensive way:
`google-drive-provider.test.ts` and `google-drive-strategy.test.ts` each stubbed a
Google module, and those stubs silently clobbered the REAL classes that the
service-level tests imported (23 phantom failures). The stubs also meant those
tests only ever exercised a hand-written *re-implementation* of the provider, not
the shipping code.

**Rule: do not `mock.module` a VROOM module you also want to test for real
elsewhere.** (Mocking a *third-party* package you never test directly — e.g.
`@aws-sdk/client-s3` — is tolerable, but prefer injection there too.)

## The pattern: constructor-inject the SDK client (or the collaborator)

Give each class an OPTIONAL constructor param for its external dependency.
Production omits it and the real client is built; tests pass an in-memory fake.
Additive, no breaking changes, and it exercises the real logic.

```ts
// google-drive-service.ts — the SDK client is injectable
constructor(refreshToken: string, driveClient?: drive_v3.Drive) {
  if (driveClient) { this.drive = driveClient; return; }      // test path
  this.oauth2Client = new google.auth.OAuth2(/* … */);         // prod path
  this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
}
```

The seam exists at three layers, pick the lowest one that covers your test:

| Layer | Class | Inject | Use when testing… |
|---|---|---|---|
| SDK client | `GoogleDriveService`, `GoogleSheetsService` | `drive_v3.Drive` / `GoogleSheetsClients` | the service's own logic (folder dedup, path walk, clear+write) |
| Service | `GoogleDriveProvider` | a `GoogleDriveService` | the provider's `StorageProvider` contract (upload/download/list) |
| Collaborator factory | `GoogleDriveStrategy` | `GoogleDriveStrategyDeps` | backup orchestration (zip/sheets/both/partial-failure/retention) |

## The fakes: `src/test-helpers/fake-google-clients.ts`

In-memory `drive_v3.Drive` + `sheets_v4.Sheets` backed by one shared
`FakeGoogleStore`, shaped like the real SDK (`{ data: { … } }` responses):

```ts
const store = new FakeGoogleStore();
// Drive-service / provider tests:
const svc = new GoogleDriveService('fake-token', makeFakeDrive(store));
// Sheets tests need all three clients over ONE store (Sheets finds its file by
// listing the Drive folder, so they must stay coherent):
const sheets = new GoogleSheetsService('fake-token', makeFakeSheetsClients(store));
```

- **Coherent**: a spreadsheet created via the Sheets API also appears as a Drive
  file, so `findVroomSpreadsheet` (which lists the folder) sees it. Don't fake the
  surfaces independently — share the store.
- **Deterministic**: IDs are a monotonic counter, timestamps a fixed epoch.
- **Seed pre-existing structure** with `store.seedFolder` / `store.seedFile`;
  assert children with `store.childrenOf(id)` (`''` = root / no-parent).
- **Narrow optionals** in `toEqual([…])` with `idOf(file)` — fails clearly if the
  expected folder was never created.

## Resilience is a first-class test target

Happy-path wiring is the easy half. The bugs live in the failure paths — expired
token (401), quota (403), rate limit (429), partial upload. Drive those with
fault injection:

```ts
store.injectFault('files.create', googleApiError(429, 'Rate limit exceeded'));
await expect(svc.uploadFile(/* … */)).rejects.toThrow('Rate limit exceeded');
```

Assert how OUR code reacts (surfaces? swallows? retries?), not the SDK's internals.
`GoogleDriveProvider.healthCheck()` swallowing an error into `false`, and
`folderExists()` swallowing into `false`, are exactly the behaviors to pin.
(The google-auth-library token-refresh-on-401 *mechanism* is upstream's to test;
we test the service's behavior once the SDK surfaces the error.)

## Credential safety (ARCC: "test credential rotation; never log/store real tokens")

- Fixtures use **canned, obviously-fake tokens only** (`'fake-refresh-token'`).
  Never a real `refresh_token`, never read from `~/.aws` / `.env` / a real account.
- The injected-client path means tests never construct a real `OAuth2Client`, so
  no token ever leaves the process.
- Keep token-expiry / re-auth handling on the test list — it's the rotation
  scenario ARCC calls out as commonly-untested.
- One optional, explicitly-gated **live** smoke (`LIVE_GDRIVE=1`) may hit the real
  API for manual verification — NEVER in the default `bun test` / `regress.sh` run.

## New external-API feature? Born testable.

Google Photos, VLM receipt parsing, LLM assistant — all follow this exact shape:

1. Implement behind an interface (`StorageProvider`, or a new
   `PhotoSourceProvider` / `VlmProvider` / `LlmProvider`).
2. Constructor-inject the SDK/HTTP client (optional param, real default). **Never a
   bare `new SomeSdkClient()` inside a method** — that's the un-testable bypass.
3. Add an in-memory fake next to `fake-google-clients.ts` (or reuse
   `FakeStorageProvider` for photo storage — selected via a `providerType: 'fake'`
   row through the registry).
4. Test the real class against the fake, including ≥2 failure-mode cases.
5. Do NOT `mock.module` the new module anywhere.
