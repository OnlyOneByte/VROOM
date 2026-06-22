/**
 * In-memory fakes for the googleapis SDK surface VROOM actually uses (Drive v3 +
 * Sheets v4). Inject these into `GoogleDriveService` / `GoogleSheetsService` via
 * their `driveClient` / `clients` constructor params to drive the REAL service
 * logic — folder find-or-create dedup, path walking, spreadsheet create+move,
 * sheet clear+write, read round-trip — with ZERO network and no `mock.module`
 * (whose process-global stubs leak across files; see google-drive-provider.test.ts).
 *
 * One {@link FakeGoogleStore} backs both clients so they stay coherent: a
 * spreadsheet created via the Sheets API also appears as a Drive file (mimeType
 * `application/vnd.google-apps.spreadsheet`), so `findVroomSpreadsheet` — which
 * lists the Drive folder — sees it after the Sheets service moves it in.
 *
 * Determinism: IDs are a monotonic counter, timestamps a fixed epoch. Tests are
 * reproducible and snapshot-safe.
 *
 * Resilience: {@link FakeGoogleStore.injectFault} makes the Nth call to a given
 * method throw a Gaxios-shaped error (401/403/429/network), so tests can assert
 * how OUR code handles API failure — the regression path that matters. (The
 * google-auth-library token-refresh-on-401 mechanism itself is upstream's to
 * test; this seam tests the service's behavior once the SDK surfaces an error.)
 */

import type { drive_v3, sheets_v4 } from 'googleapis';
import { GoogleDriveService } from '../api/providers/services/google-drive-service';
import type { GoogleSheetsClients } from '../api/providers/services/google-sheets-service';

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  webViewLink: string;
  size: number;
  content: Buffer;
  createdTime: string;
  modifiedTime: string;
}

interface FakePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
}

interface FakeSpreadsheet {
  title: string;
  sheets: { sheetId: number; title: string }[];
  /** sheet title → 2D cell grid (as written by values.update) */
  values: Map<string, (string | number | boolean)[][]>;
  /**
   * sheet title → the `valueInputOption` the last values.update for it passed. The grid is stored
   * identically regardless of the option, so a round-trip read can't prove we send RAW (the #36 formula-
   * injection fix); this captures the option so a guard can assert it directly (RAW vs USER_ENTERED).
   */
  valueInputOptions: Map<string, string | undefined>;
  /**
   * Monotonic sheetId source. Real Sheets never reuses a sheetId; using `sheets.length` would collide
   * after a delete+rename cycle (the #37 atomic-swap backup deletes old tabs then renames staging ones),
   * so the second backup's addSheet would clash with a surviving id. Counts only ever up.
   */
  nextSheetId: number;
}

interface FaultRule {
  method: string;
  error: Error;
  remaining: number;
}

const EPOCH = new Date(0).toISOString();

/**
 * Assert a `.find()`-ed fake file/folder exists and return its id as a definite
 * `string` (keeps `toEqual([...])` assertions strictly typed, and fails with a
 * clear message if the expected folder/file was never created).
 */
export function idOf(file: { id: string } | undefined | null): string {
  if (!file) throw new Error('expected a fake Drive file/folder to exist, got none');
  return file.id;
}

/** A Gaxios-shaped error so service code that inspects `.code`/`.status` behaves as in prod. */
export function googleApiError(
  code: number,
  message: string
): Error & { code: number; status: number } {
  const err = new Error(message) as Error & { code: number; status: number };
  err.code = code;
  err.status = code;
  return err;
}

/**
 * Shared backing store for the fake Drive + Sheets clients. Construct one per test
 * for isolation; seed pre-existing folders/files via {@link seedFolder}/{@link seedFile}.
 */
export class FakeGoogleStore {
  files = new Map<string, FakeFile>();
  permissions = new Map<string, FakePermission[]>();
  spreadsheets = new Map<string, FakeSpreadsheet>();
  private idCounter = 0;
  private faults: FaultRule[] = [];

  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  /** Make the next `times` call(s) to `method` (e.g. 'files.create') throw `error`. */
  injectFault(method: string, error: Error, times = 1): void {
    this.faults.push({ method, error, remaining: times });
  }

  /** Throws (and consumes a use) if a fault is armed for `method`. Called by every fake op. */
  maybeFail(method: string): void {
    const rule = this.faults.find((f) => f.method === method && f.remaining > 0);
    if (rule) {
      rule.remaining -= 1;
      throw rule.error;
    }
  }

  /** Seed a folder directly (bypasses the API) — handy for pre-existing-structure tests. */
  seedFolder(name: string, parentId = ''): string {
    const id = this.nextId('folder');
    this.files.set(id, {
      id,
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : [],
      trashed: false,
      webViewLink: `https://drive.google.com/drive/folders/${id}`,
      size: 0,
      content: Buffer.alloc(0),
      createdTime: EPOCH,
      modifiedTime: EPOCH,
    });
    return id;
  }

  /** Seed an arbitrary file directly (bypasses the API). */
  seedFile(opts: { name: string; mimeType: string; parentId?: string; content?: Buffer }): string {
    const id = this.nextId('file');
    const content = opts.content ?? Buffer.alloc(0);
    this.files.set(id, {
      id,
      name: opts.name,
      mimeType: opts.mimeType,
      parents: opts.parentId ? [opts.parentId] : [],
      trashed: false,
      webViewLink: `https://drive.google.com/file/d/${id}/view`,
      size: content.length,
      content,
      createdTime: EPOCH,
      modifiedTime: EPOCH,
    });
    return id;
  }

  /**
   * Convenience for assertions: list the (non-trashed) children of a folder id.
   * Pass `''` for root-level items — folders created without a parent land with
   * an empty `parents` array (VROOM's createFolder omits the field), so root is
   * "no parents", not the literal id `''`.
   */
  childrenOf(parentId: string): FakeFile[] {
    return [...this.files.values()].filter((f) => {
      if (f.trashed) return false;
      return parentId === '' ? f.parents.length === 0 : f.parents.includes(parentId);
    });
  }
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  // Node Readable (what GoogleDriveService.uploadFile passes)
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toApiFile(f: FakeFile): drive_v3.Schema$File {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    parents: f.parents,
    webViewLink: f.webViewLink,
    size: String(f.size),
    trashed: f.trashed,
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
  };
}

/** Parse the small dialect of Drive query strings GoogleDriveService builds. */
function matchesDriveQuery(f: FakeFile, q: string): boolean {
  if (f.trashed) return false; // every query VROOM builds includes trashed=false
  const nameMatch = q.match(/name='((?:\\.|[^'\\])*)'/);
  if (nameMatch) {
    const wanted = nameMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (f.name !== wanted) return false;
  }
  const parentMatch = q.match(/'([^']+)' in parents/);
  if (parentMatch && !f.parents.includes(parentMatch[1])) return false;
  const mimeMatch = q.match(/mimeType='([^']+)'/);
  if (mimeMatch && f.mimeType !== mimeMatch[1]) return false;
  return true;
}

/** Build a fake `drive_v3.Drive` backed by `store`. */
export function makeFakeDrive(store: FakeGoogleStore): drive_v3.Drive {
  const files = {
    list(params: drive_v3.Params$Resource$Files$List = {}) {
      store.maybeFail('files.list');
      let results = [...store.files.values()].filter((f) =>
        params.q ? matchesDriveQuery(f, params.q) : !f.trashed
      );
      if (params.orderBy === 'modifiedTime desc') {
        results = results.reverse(); // deterministic: newest-inserted first
      }
      const pageSize = params.pageSize ?? 1000;
      const start = params.pageToken ? Number(params.pageToken) : 0;
      const page = results.slice(start, start + pageSize);
      const nextStart = start + pageSize;
      const nextPageToken = nextStart < results.length ? String(nextStart) : undefined;
      return Promise.resolve({
        data: { files: page.map(toApiFile), nextPageToken },
      });
    },

    async create(params: drive_v3.Params$Resource$Files$Create = {}) {
      store.maybeFail('files.create');
      const body = (params.requestBody ?? {}) as drive_v3.Schema$File;
      const media = params.media as { mimeType?: string; body?: unknown } | undefined;
      const content = media?.body ? await streamToBuffer(media.body) : Buffer.alloc(0);
      const id = store.nextId(
        body.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file'
      );
      const file: FakeFile = {
        id,
        name: body.name ?? 'untitled',
        mimeType: body.mimeType ?? media?.mimeType ?? 'application/octet-stream',
        parents: body.parents ?? [],
        trashed: false,
        webViewLink:
          body.mimeType === 'application/vnd.google-apps.folder'
            ? `https://drive.google.com/drive/folders/${id}`
            : `https://drive.google.com/file/d/${id}/view`,
        size: content.length,
        content,
        createdTime: EPOCH,
        modifiedTime: EPOCH,
      };
      store.files.set(id, file);
      return { data: toApiFile(file) };
    },

    update(params: drive_v3.Params$Resource$Files$Update = {}) {
      store.maybeFail('files.update');
      const file = params.fileId ? store.files.get(params.fileId) : undefined;
      if (!file) return Promise.reject(googleApiError(404, `File not found: ${params.fileId}`));
      const body = (params.requestBody ?? {}) as drive_v3.Schema$File;
      if (body.name) file.name = body.name;
      if (params.removeParents) {
        const toRemove = params.removeParents.split(',');
        file.parents = file.parents.filter((p) => !toRemove.includes(p));
      }
      if (params.addParents) file.parents.push(...params.addParents.split(','));
      return Promise.resolve({ data: toApiFile(file) });
    },

    delete(params: drive_v3.Params$Resource$Files$Delete = {}) {
      store.maybeFail('files.delete');
      if (params.fileId) store.files.delete(params.fileId);
      return Promise.resolve({ data: {} });
    },

    get(params: drive_v3.Params$Resource$Files$Get = {}, _opts?: unknown) {
      store.maybeFail('files.get');
      const file = params.fileId ? store.files.get(params.fileId) : undefined;
      if (!file) return Promise.reject(googleApiError(404, `File not found: ${params.fileId}`));
      if (params.alt === 'media') {
        const ab = file.content.buffer.slice(
          file.content.byteOffset,
          file.content.byteOffset + file.content.byteLength
        );
        return Promise.resolve({ data: ab });
      }
      return Promise.resolve({ data: toApiFile(file) });
    },
  };

  const permissions = {
    list(params: drive_v3.Params$Resource$Permissions$List = {}) {
      store.maybeFail('permissions.list');
      return Promise.resolve({
        data: { permissions: store.permissions.get(params.fileId ?? '') ?? [] },
      });
    },
    create(params: drive_v3.Params$Resource$Permissions$Create = {}) {
      store.maybeFail('permissions.create');
      const body = (params.requestBody ?? {}) as drive_v3.Schema$Permission;
      const perm: FakePermission = {
        id: store.nextId('perm'),
        type: body.type ?? 'user',
        role: body.role ?? 'reader',
        emailAddress: body.emailAddress ?? undefined,
      };
      const existing = store.permissions.get(params.fileId ?? '') ?? [];
      existing.push(perm);
      store.permissions.set(params.fileId ?? '', existing);
      return Promise.resolve({ data: perm });
    },
  };

  return { files, permissions } as unknown as drive_v3.Drive;
}

/** Sheet title is everything before the final `!` in an A1 range like `Expenses!A:Z`. */
function sheetTitleFromRange(range: string): string {
  const bang = range.lastIndexOf('!');
  return bang === -1 ? range : range.slice(0, bang);
}

/** addSheet: append a new empty tab with a monotonic sheetId (never reused — mirrors real Sheets). */
function applyAddSheet(ss: FakeSpreadsheet, req: sheets_v4.Schema$AddSheetRequest): void {
  const title = req.properties?.title;
  if (title && !ss.sheets.some((s) => s.title === title)) {
    ss.sheets.push({ sheetId: ss.nextSheetId, title });
    ss.nextSheetId += 1;
  }
}

/** deleteSheet: drop a tab by id, along with its cell grid + value-input option. */
function applyDeleteSheet(ss: FakeSpreadsheet, req: sheets_v4.Schema$DeleteSheetRequest): void {
  const id = req.sheetId;
  if (id === undefined || id === null) return;
  const sheet = ss.sheets.find((s) => s.sheetId === id);
  if (!sheet) return;
  ss.values.delete(sheet.title);
  ss.valueInputOptions.delete(sheet.title);
  ss.sheets = ss.sheets.filter((s) => s.sheetId !== id);
}

/**
 * updateSheetProperties: rename a tab (carrying its grid + value-input option to the new title) and/or
 * reposition it to `index`. The #37 atomic swap renames each staging tab to its canonical title AND sets
 * index to its canonical position so tab order is preserved across backups; honoring index here lets the
 * order assertion exercise that. Reposition = remove from current slot, splice in at `index`.
 */
function applyRenameSheet(
  ss: FakeSpreadsheet,
  req: sheets_v4.Schema$UpdateSheetPropertiesRequest
): void {
  const id = req.properties?.sheetId;
  if (id === undefined || id === null) return;
  const sheet = ss.sheets.find((s) => s.sheetId === id);
  if (!sheet) return;

  const newTitle = req.properties?.title;
  if (newTitle && sheet.title !== newTitle) {
    const grid = ss.values.get(sheet.title);
    const opt = ss.valueInputOptions.get(sheet.title);
    ss.values.delete(sheet.title);
    ss.valueInputOptions.delete(sheet.title);
    if (grid !== undefined) ss.values.set(newTitle, grid);
    if (opt !== undefined) ss.valueInputOptions.set(newTitle, opt);
    sheet.title = newTitle;
  }

  const index = req.properties?.index;
  if (index !== undefined && index !== null) {
    ss.sheets = ss.sheets.filter((s) => s.sheetId !== id);
    ss.sheets.splice(index, 0, sheet);
  }
}

/**
 * Apply a spreadsheets.batchUpdate request list in order: addSheet (new empty tab, monotonic id),
 * deleteSheet (drop a tab + its grid), updateSheetProperties (rename a tab, carrying its grid +
 * value-input option to the new title). This is the surface the #37 atomic-swap backup drives
 * (stage → delete old + rename staging → canonical, all in one batch).
 */
function applyBatchRequests(ss: FakeSpreadsheet, requests: sheets_v4.Schema$Request[]): void {
  for (const req of requests) {
    if (req.addSheet) applyAddSheet(ss, req.addSheet);
    else if (req.deleteSheet) applyDeleteSheet(ss, req.deleteSheet);
    else if (req.updateSheetProperties) applyRenameSheet(ss, req.updateSheetProperties);
  }
}

/** Build a fake `sheets_v4.Sheets` backed by `store`. */
export function makeFakeSheets(store: FakeGoogleStore): sheets_v4.Sheets {
  const spreadsheets = {
    create(params: sheets_v4.Params$Resource$Spreadsheets$Create = {}) {
      store.maybeFail('spreadsheets.create');
      const body = (params.requestBody ?? {}) as sheets_v4.Schema$Spreadsheet;
      const title = body.properties?.title ?? 'Untitled';
      const sheets = (body.sheets ?? []).map((s, i) => ({
        sheetId: i,
        title: s.properties?.title ?? `Sheet${i}`,
      }));
      const id = store.nextId('spreadsheet');
      const nextSheetId = sheets.length;
      // Register as a Drive file too, so listing the folder finds it (coherence).
      store.files.set(id, {
        id,
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: ['root'],
        trashed: false,
        webViewLink: `https://docs.google.com/spreadsheets/d/${id}`,
        size: 0,
        content: Buffer.alloc(0),
        createdTime: EPOCH,
        modifiedTime: EPOCH,
      });
      store.spreadsheets.set(id, {
        title,
        sheets,
        values: new Map(),
        valueInputOptions: new Map(),
        nextSheetId,
      });
      return Promise.resolve({
        data: {
          spreadsheetId: id,
          properties: { title },
          sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })),
        },
      });
    },

    get(params: sheets_v4.Params$Resource$Spreadsheets$Get = {}) {
      store.maybeFail('spreadsheets.get');
      const ss = params.spreadsheetId ? store.spreadsheets.get(params.spreadsheetId) : undefined;
      if (!ss)
        return Promise.reject(
          googleApiError(404, `Spreadsheet not found: ${params.spreadsheetId}`)
        );
      return Promise.resolve({
        data: {
          spreadsheetId: params.spreadsheetId,
          properties: { title: ss.title },
          sheets: ss.sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })),
        },
      });
    },

    batchUpdate(params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate = {}) {
      store.maybeFail('spreadsheets.batchUpdate');
      const ss = params.spreadsheetId ? store.spreadsheets.get(params.spreadsheetId) : undefined;
      if (!ss)
        return Promise.reject(
          googleApiError(404, `Spreadsheet not found: ${params.spreadsheetId}`)
        );
      applyBatchRequests(ss, (params.requestBody?.requests ?? []) as sheets_v4.Schema$Request[]);
      return Promise.resolve({ data: {} });
    },

    values: {
      clear(params: sheets_v4.Params$Resource$Spreadsheets$Values$Clear = {}) {
        store.maybeFail('spreadsheets.values.clear');
        const ss = params.spreadsheetId ? store.spreadsheets.get(params.spreadsheetId) : undefined;
        if (ss && params.range) ss.values.delete(sheetTitleFromRange(params.range));
        return Promise.resolve({ data: {} });
      },
      update(params: sheets_v4.Params$Resource$Spreadsheets$Values$Update = {}) {
        store.maybeFail('spreadsheets.values.update');
        const ss = params.spreadsheetId ? store.spreadsheets.get(params.spreadsheetId) : undefined;
        if (ss && params.range) {
          const title = sheetTitleFromRange(params.range);
          const values = (params.requestBody?.values ?? []) as (string | number | boolean)[][];
          ss.values.set(title, values);
          ss.valueInputOptions.set(title, params.valueInputOption ?? undefined);
        }
        return Promise.resolve({ data: { updatedCells: 0 } });
      },
      get(params: sheets_v4.Params$Resource$Spreadsheets$Values$Get = {}) {
        store.maybeFail('spreadsheets.values.get');
        const ss = params.spreadsheetId ? store.spreadsheets.get(params.spreadsheetId) : undefined;
        const values =
          ss && params.range ? ss.values.get(sheetTitleFromRange(params.range)) : undefined;
        return Promise.resolve({ data: { values: values ?? [] } });
      },
    },
  };

  return { spreadsheets } as unknown as sheets_v4.Sheets;
}

/**
 * Build the full {@link GoogleSheetsClients} bundle (sheets + drive + a real
 * GoogleDriveService wired to the fake drive) over ONE shared store, so the
 * Sheets service's folder walk, file move, and folder listing all stay coherent.
 * Pass the returned `clients` straight into `new GoogleSheetsService(token, clients)`.
 */
export function makeFakeSheetsClients(store: FakeGoogleStore): GoogleSheetsClients {
  const drive = makeFakeDrive(store);
  return {
    sheets: makeFakeSheets(store),
    drive,
    driveService: new GoogleDriveService('fake-refresh-token', drive),
  };
}
