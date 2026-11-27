import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  '..'
);
const CHILD_LIMIT_MS = 20_000;
const MODEL = 'eng.traineddata.gz';

const root = mkdtempSync(join(tmpdir(), 'vroom-ocr-model-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function modelDir(name: string, write: (file: string) => void): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  write(join(dir, MODEL));
  return dir;
}

const noise = new Uint8Array(4096).map((_, i) => (i * 7919) % 251);

const LOCAL_OCR = join(BACKEND_ROOT, 'src', 'api', 'providers', 'domains', 'vlm', 'local-ocr.ts');

async function scanWith(langPath: string) {
  const script = [
    `const ocr = await import(${JSON.stringify(LOCAL_OCR)});`,
    `ocr.setLocalOcrForTest({ langPath: ${JSON.stringify(langPath)}, timeoutMs: 8000 });`,
    "const outcome = await ocr.recognizeText(Buffer.from('x')).then(",
    "  () => 'read',",
    "  (error) => (error instanceof ocr.OcrUnavailableError ? 'unavailable' : 'other: ' + error)",
    ');',
    "console.log('OUTCOME ' + outcome);",
  ].join('\n');
  const scriptFile = join(langPath, 'scan.ts');
  writeFileSync(scriptFile, script);
  const proc = Bun.spawn([process.execPath, '--env-file=/dev/null', 'run', scriptFile], {
    cwd: BACKEND_ROOT,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, CHILD_LIMIT_MS);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, timedOut, stdout, stderr };
}

describe('the built-in text reader with a broken model on disk', () => {
  test.each([
    ['a corrupt gzip model', () => modelDir('gz', (f) => writeFileSync(f, Bun.gzipSync(noise)))],
    ['a model that is not gzip at all', () => modelDir('plain', (f) => writeFileSync(f, noise))],
  ])(
    '%s makes scans unavailable and leaves the server running',
    async (_name, make) => {
      const result = await scanWith(make());
      expect(result.stderr).not.toContain('TypeError');
      expect(result.stdout).toContain('OUTCOME unavailable');
      expect(result.code).toBe(0);
    },
    CHILD_LIMIT_MS + 10_000
  );

  test(
    'a model that cannot be read leaves no worker thread running, so the process can exit',
    async () => {
      const dir = join(root, 'unreadable');
      mkdirSync(join(dir, MODEL), { recursive: true });

      const result = await scanWith(dir);

      expect(result.stdout).toContain('OUTCOME unavailable');
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
    },
    CHILD_LIMIT_MS + 10_000
  );
});
