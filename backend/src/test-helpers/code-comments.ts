import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const REPO_ROOT = join(import.meta.dir, '../../..');

const SCAN_ROOTS = ['backend/src', 'frontend/src', 'frontend/e2e', 'frontend/scripts'];
const SKIP_DIRS = new Set(['node_modules', '.svelte-kit', 'build', 'dist']);
const SCRIPT_EXT = /\.(ts|js|mjs|cjs)$/;
const DIRECTIVE =
  /^(biome-ignore|eslint-disable|eslint-enable|@ts-expect-error|@ts-ignore|@ts-nocheck|prettier-ignore|svelte-ignore|@vitest-environment|<reference|v8 ignore|c8 ignore|istanbul ignore)/;

const REGEX_AFTER_CHAR = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

function normalize(raw: string): string {
  return raw
    .replace(/^\/\/+/, '')
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDirective(text: string): boolean {
  return text === '' || DIRECTIVE.test(text);
}

function skipString(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length && src[i] !== quote && src[i] !== '\n') {
    i += src[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

function skipRegex(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length && src[i] !== '\n') {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) break;
    i++;
  }
  i++;
  while (i < src.length && /[a-z]/i.test(src[i] ?? '')) i++;
  return i;
}

function regexAllowed(src: string, slash: number): boolean {
  let i = slash - 1;
  while (i >= 0 && /\s/.test(src[i] ?? '')) i--;
  if (i < 0) return true;
  const c = src[i] ?? '';
  if (REGEX_AFTER_CHAR.has(c)) return true;
  if (!/[\w$]/.test(c)) return false;
  let start = i;
  while (start >= 0 && /[\w$]/.test(src[start] ?? '')) start--;
  return REGEX_AFTER_WORD.has(src.slice(start + 1, i + 1));
}

interface LexState {
  src: string;
  i: number;
  depth: number;
  templateDepths: number[];
  out: string[];
}

function resumeTemplate(s: LexState, from: number): number {
  let j = from;
  while (j < s.src.length) {
    const c = s.src[j];
    if (c === '\\') {
      j += 2;
    } else if (c === '`') {
      return j + 1;
    } else if (c === '$' && s.src[j + 1] === '{') {
      s.templateDepths.push(s.depth);
      s.depth++;
      return j + 2;
    } else {
      j++;
    }
  }
  return j;
}

function takeComment(s: LexState): boolean {
  if (s.src[s.i] !== '/') return false;
  const next = s.src[s.i + 1];
  if (next !== '/' && next !== '*') return false;
  const end = next === '/' ? s.src.indexOf('\n', s.i) : s.src.indexOf('*/', s.i + 2);
  const stop = end === -1 ? s.src.length : next === '/' ? end : end + 2;
  s.out.push(s.src.slice(s.i, stop));
  s.i = stop;
  return true;
}

function skipLiteral(s: LexState): boolean {
  const c = s.src[s.i] ?? '';
  if (c === '"' || c === "'") s.i = skipString(s.src, s.i, c);
  else if (c === '`') s.i = resumeTemplate(s, s.i + 1);
  else if (c === '/' && regexAllowed(s.src, s.i)) s.i = skipRegex(s.src, s.i);
  else return false;
  return true;
}

function trackBrace(s: LexState): boolean {
  const c = s.src[s.i];
  if (c === '{') {
    s.depth++;
    s.i++;
    return true;
  }
  if (c !== '}') return false;
  s.depth--;
  if (s.templateDepths.at(-1) === s.depth) {
    s.templateDepths.pop();
    s.i = resumeTemplate(s, s.i + 1);
  } else {
    s.i++;
  }
  return true;
}

export function scriptComments(src: string): string[] {
  const s: LexState = { src, i: 0, depth: 0, templateDepths: [], out: [] };
  while (s.i < src.length) {
    if (!takeComment(s) && !skipLiteral(s) && !trackBrace(s)) s.i++;
  }
  return s.out;
}

function cssComments(source: string): string[] {
  return source.match(/\/\*[\s\S]*?\*\//g) ?? [];
}

export function svelteComments(source: string): string[] {
  const out: string[] = [];
  const scripts = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  const styles = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  for (const match of source.matchAll(scripts)) out.push(...scriptComments(match[1] ?? ''));
  for (const match of source.matchAll(styles)) out.push(...cssComments(match[1] ?? ''));
  const markup = source.replace(scripts, '').replace(styles, '');
  out.push(...(markup.match(/<!--[\s\S]*?-->/g) ?? []));
  return out;
}

export function commentsIn(path: string, source: string): string[] {
  let raw: string[] = [];
  if (path.endsWith('.svelte')) raw = svelteComments(source);
  else if (path.endsWith('.css')) raw = cssComments(source);
  else if (SCRIPT_EXT.test(path)) raw = scriptComments(source);
  return raw.map(normalize).filter((text) => !isDirective(text));
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (/\.(ts|js|mjs|cjs|svelte|css)$/.test(entry)) {
      out.push(full);
    }
  }
}

export function scanCodeComments(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), files);
  return files.flatMap((file) => {
    const rel = relative(REPO_ROOT, file);
    return commentsIn(file, readFileSync(file, 'utf8')).map((text) => `${rel}: ${text}`);
  });
}
