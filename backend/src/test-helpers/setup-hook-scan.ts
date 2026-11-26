import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OPEN = '([{';
const CLOSE = ')]}';
const QUOTES = '\'"`';

function skipString(source: string, at: number): number {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length && source[i] !== quote) {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i;
}

function topLevelArgs(source: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < source.length; i++) {
    const ch = source[i] as string;
    if (QUOTES.includes(ch)) {
      i = skipString(source, i);
    } else if (OPEN.includes(ch)) {
      depth++;
    } else if (CLOSE.includes(ch) && depth > 0) {
      depth--;
    } else if (CLOSE.includes(ch)) {
      args.push(source.slice(from, i));
      return args.filter((arg) => arg.trim() !== '');
    } else if (ch === ',' && depth === 0) {
      args.push(source.slice(from, i));
      from = i + 1;
    }
  }
  return args;
}

export function setupHooksWithoutTimeout(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/\b(?:beforeEach|beforeAll)\(/g)) {
    const args = topLevelArgs(source, (match.index ?? 0) + match[0].length);
    if (args[0]?.includes('createTestApp(') && args.length < 2) count++;
  }
  return count;
}

export function scanSetupHooks(srcDir: string): Record<string, number> {
  const found: Record<string, number> = {};
  const files = [...new Bun.Glob('**/*.test.ts').scanSync(srcDir)].sort();
  for (const file of files) {
    const count = setupHooksWithoutTimeout(readFileSync(join(srcDir, file), 'utf8'));
    if (count > 0) found[file] = count;
  }
  return found;
}
