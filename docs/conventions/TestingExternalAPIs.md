# Testing External APIs — inject a client, don't `mock.module`

VROOM talks to third-party APIs: Google Drive, Google Sheets, Google Photos, S3,
and the VLM/LLM adapters (Anthropic, Gemini, OpenAI-compatible). Tests must NEVER
hit a real one: no network, no credentials, deterministic.

## The trap: `mock.module` leaks across files

Bun's `mock.module(specifier, factory)` is **process-global and permanent for the
run**. `bunfig.toml` sets `concurrency = 1`, so every test file shares one process
— a stub registered in file A replaces that module in files B, C, D too. And a
stubbed VROOM module means the test exercises a hand-written *re-implementation*
instead of the shipping code.

**Rule: never `mock.module` a VROOM module.** Mocking a *third-party* package you
never test directly is tolerable — `@aws-sdk/client-s3` /
`@aws-sdk/s3-request-presigner` and `hono/bun` are the only ones in the tree.

## Pattern 1 — constructor-inject the client (SDK-object APIs)

Give the class an OPTIONAL constructor param for its external dependency.
Production omits it and builds the real client; tests pass an in-memory fake.
Additive, and it exercises the real logic.

```ts
// google-drive-service.ts — the SDK client is injectable
constructor(refreshToken: string, driveClient?: drive_v3.Drive) {
  if (driveClient) { this.drive = driveClient; return; }      // test path
  this.oauth2Client = new google.auth.OAuth2(/* … */);         // prod path
  this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
}
```

Seams exist at three layers — pick the lowest one that covers your test:

| Layer | Class | Inject | Use when testing… |
|---|---|---|---|
| SDK client | `GoogleDriveService`, `GoogleSheetsService`, `GooglePhotosService` | `drive_v3.Drive` / `GoogleSheetsClients` / `PhotosClient` | the service's own logic (folder dedup, path walk, clear+write, album resolve) |
| Service | `GoogleDriveProvider`, `GooglePhotosProvider` | the matching service | the `StorageProvider` contract (upload/download/list/delete) |
| Collaborator factory | `GoogleDriveStrategy`, `processBatch` | `GoogleDriveStrategyDeps` / `SyncWorkerDeps` | backup orchestration (zip/sheets/both/partial-failure/retention), photo-sync batches |

`S3CompatProvider` is the exception with no seam — it builds its `S3Client` in the
constructor, which is why its tests `mock.module` the AWS SDK.

## Pattern 2 — stub `globalThis.fetch` (raw-HTTP APIs)

The VLM and LLM adapters call `fetch` directly, with no SDK object to inject. Save
the real `fetch`, replace it, **restore it in `afterEach`** (an un-restored stub
leaks across files exactly like `mock.module`). Capture the request so you can
assert URL, headers, and body shape:

```ts
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

stubFetch(() => new Response('overloaded', { status: 529 }));
await expect(provider.extractReceipt(IMAGE)).rejects.toThrow(/HTTP 529/);
```

## The fakes: `src/test-helpers/fake-google-clients.ts`

In-memory `drive_v3.Drive` + `sheets_v4.Sheets` backed by one shared
`FakeGoogleStore`, shaped like the real SDK (`{ data: { … } }` responses).
`fake-google-photos-client.ts` is the same shape for `PhotosClient`.

```ts
const store = new FakeGoogleStore();
const svc = new GoogleDriveService('fake-refresh-token', makeFakeDrive(store));
const sheets = new GoogleSheetsService('fake-refresh-token', makeFakeSheetsClients(store));
```

- **Share one store.** `makeFakeSheetsClients` bundles Sheets + Drive because a
  spreadsheet created via the Sheets API must also appear as a Drive file for
  `findVroomSpreadsheet` (which lists the folder) to see it. Never fake the two
  surfaces independently.
- **Deterministic**: IDs are a monotonic counter, timestamps a fixed epoch.
- Seed pre-existing structure with `store.seedFolder` / `store.seedFile`; assert
  children with `store.childrenOf(id)` (`''` = root / no-parent). `idOf(file)`
  narrows an optional in `toEqual([…])` and fails clearly when the expected
  folder was never created.

## Resilience is a first-class test target

Happy-path wiring is the easy half. The bugs live in the failure paths — expired
token (401), quota (403), rate limit (429), partial upload. Drive those with
fault injection (`injectFault(method, error, times = 1)` consumes one use per call):

```ts
store.injectFault('files.create', googleApiError(429, 'Rate limit exceeded'));
await expect(svc.uploadFile(/* … */)).rejects.toThrow('Rate limit exceeded');
```

Assert how OUR code reacts (surfaces? swallows? retries?), not the SDK's internals.
`GoogleDriveProvider.healthCheck()` and `GoogleDriveService.folderExists()` each
swallowing an error into `false` are exactly the behaviors to pin. The
google-auth-library token-refresh-on-401 *mechanism* is upstream's to test; we test
our behavior once the SDK surfaces the error.

## Credential safety

Fixtures use canned, obviously-fake tokens only (`'fake-refresh-token'`) — never a
real `refresh_token`, never read from `~/.aws` / `.env` / a real account. The
injected-client path means tests never construct a real `OAuth2Client`, so no token
leaves the process. Keep token-expiry / re-auth on the test list; rotation is the
commonly-untested path.

## `FakeStorageProvider` is a dev-server seam, not a test seam

`domains/storage/fake-provider.ts` is an in-memory `StorageProvider`, but the
registry instantiates a `providerType: 'fake'` row only when
`CONFIG.allowFakeStorageProvider` (`ALLOW_FAKE_STORAGE=1` AND
`NODE_ENV !== 'production'`). `CONFIG` is a process-cached env snapshot taken at
first import, so a test file cannot flip that flag in the full suite. Under
`bun test`: construct `new FakeStorageProvider()` directly, and for route-level
HTTP nets pick an ungated type (`s3`). The `fake` row belongs to the local dev
server.

## New external-API feature? Born testable.

1. Implement behind the domain interface (`StorageProvider`, `VlmProvider`,
   `LlmProvider`).
2. Make the transport substitutable: an optional constructor param for the SDK
   client or collaborator, or a plain `fetch` call a test can stub. **Never a bare
   `new SomeSdkClient()` inside a method** — that's the un-testable bypass.
3. If the API has a client object, add an in-memory fake beside the existing ones
   in `src/test-helpers/`.
4. Test the real class against the fake, including ≥2 failure-mode cases.
