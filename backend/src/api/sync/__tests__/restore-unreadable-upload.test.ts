/**
 * Bytes that are not a readable backup are the CLIENT's error, not a server fault.
 *
 * Every other refusal on `POST /api/v1/sync/restore/from-backup` is a clean 400 naming what is wrong —
 * user-id mismatch, schema/referential validation, the empty-replace guard, the zip-bomb ratio. An
 * unwrapped AdmZip or csv-parse throw instead reached the global error handler as
 * 500 "An internal error occurred", so the single likeliest restore mistake — picking the wrong file in
 * the dialog — told the user VROOM had crashed, and told a self-hosted operator's monitoring that the
 * server had faulted. The wrapper must not swallow the parser's OWN refusals either: those already
 * carry a specific, actionable message and are re-thrown unchanged.
 *
 * Driven over the real HTTP stack because the status code is the whole point. Multipart is a "simple"
 * content type, so hono's csrf guard checks Origin — hence the explicit header.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createTestApp, type TestApp } from '../../../test-helpers/http-client';

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
});
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
    // One row carrying more fields than the header — what a spreadsheet round-trip or a hand-edit
    // produces, and what csv-parse rejects with CSV_RECORD_INCONSISTENT_COLUMNS.
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
