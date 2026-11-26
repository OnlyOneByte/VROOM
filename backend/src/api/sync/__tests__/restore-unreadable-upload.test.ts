import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, SETUP_TIMEOUT_MS, type TestApp } from '../../../test-helpers/http-client';

const RESTORE_PATH = '/api/v1/sync/restore/from-backup';
const TEST_ORIGIN = 'http://localhost:3000';

interface ErrorBody {
  success?: boolean;
  error?: { code?: string; message?: string };
}

let ctx: TestApp;
let keyCounter = 0;

beforeEach(async () => {
  ctx = await createTestApp();
}, SETUP_TIMEOUT_MS);
afterEach(() => ctx.close());

async function upload(bytes: Buffer, fileName = 'backup.zip'): Promise<Response> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], fileName), fileName);
  form.append('mode', 'preview');
  return ctx.app.request(RESTORE_PATH, {
    method: 'POST',
    headers: {
      cookie: ctx.cookie,
      origin: TEST_ORIGIN,
      'idempotency-key': `unreadable-upload-${++keyCounter}`,
    },
    body: form,
  });
}

describe('an unreadable restore upload is a 400, not a 500', () => {
  test('a file that is not a ZIP at all is refused with a named validation error', async () => {
    const res = await upload(
      Buffer.from('this is my tax return, not a backup', 'utf-8'),
      'taxes.pdf'
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error?.code).toBe('ValidationError');
    expect(body.error?.message).toContain('not a readable VROOM backup');
  });

  test('a genuine backup ZIP with one malformed CSV is refused with the same validation error', async () => {
    const { backupService } = await import('../backup');
    const AdmZip = (await import('adm-zip')).default;

    const zip = new AdmZip(await backupService.exportAsZip(ctx.user.id));
    const expensesCsv = zip.getEntry('expenses.csv')?.getData().toString('utf-8') ?? '';
    const columnCount = expensesCsv.split('\n')[0].split(',').length;
    zip.updateFile(
      'expenses.csv',
      Buffer.from(`${expensesCsv.trimEnd()}\n${'"x",'.repeat(columnCount)}"surplus"\n`, 'utf-8')
    );

    const res = await upload(zip.toBuffer());
    const body = (await res.json()) as ErrorBody;

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error?.code).toBe('ValidationError');
    expect(body.error?.message).toContain('not a readable VROOM backup');
  });

  test("the parser's own refusals keep their specific message rather than being re-labelled", async () => {
    const AdmZip = (await import('adm-zip')).default;
    const emptyZip = new AdmZip();
    emptyZip.addFile('readme.txt', Buffer.from('nothing to see', 'utf-8'));

    const res = await upload(emptyZip.toBuffer());
    const body = (await res.json()) as ErrorBody;

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(body.error?.message).toContain('Missing required files');
  });
});

describe('a restore request that is not a multipart file upload is a 400, not a 500', () => {
  async function post(body: FormData | string, contentType?: string): Promise<Response> {
    return ctx.app.request(RESTORE_PATH, {
      method: 'POST',
      headers: {
        cookie: ctx.cookie,
        origin: TEST_ORIGIN,
        'idempotency-key': `not-multipart-${++keyCounter}`,
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body,
    });
  }

  test('JSON, urlencoded and boundary-less multipart bodies are refused', async () => {
    const cases: Array<{ body: string; contentType: string }> = [
      { body: JSON.stringify({ file: 'x' }), contentType: 'application/json' },
      { body: 'file=x&mode=preview', contentType: 'application/x-www-form-urlencoded' },
      { body: 'no boundary here', contentType: 'multipart/form-data' },
    ];
    for (const { body, contentType } of cases) {
      const res = await post(body, contentType);
      const json = (await res.json()) as ErrorBody;
      expect(res.status, `${contentType}: ${JSON.stringify(json)}`).toBe(400);
      expect(json.success).toBe(false);
    }
  });

  test('a file field sent as text is refused as a missing file', async () => {
    const form = new FormData();
    form.append('file', 'not-a-file');
    const res = await post(form);
    const json = (await res.json()) as ErrorBody;
    expect(res.status).toBe(400);
    expect(json.error?.message).toBe('No file provided');
  });
});
