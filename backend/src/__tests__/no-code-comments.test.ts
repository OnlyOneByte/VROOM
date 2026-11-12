import { expect } from 'bun:test';
import { commentsIn, scanCodeComments } from '../test-helpers/code-comments';
import { ratchet } from '../test-helpers/debt-ratchet';
import COMMENT_ALLOWLIST from './no-code-comments.allowlist.json';

const TEMPLATE_WITH_EXPRESSION = ['const t = `$', '{a /* inside */} // text`;'].join('');

ratchet({
  name: 'no comments in code',
  kind: 'exclusion',
  scan: scanCodeComments,
  tolerated: COMMENT_ALLOWLIST,
  guidance:
    'New comments in code (CLAUDE.md quality bar #6). Delete them and let names, types, and structure ' +
    'carry the intent. Only an external constraint the code cannot express may stay, as one line, ' +
    'added to backend/src/__tests__/no-code-comments.allowlist.json:',
  probe: () => {
    expect(commentsIn('a.ts', 'const x = 1; // trailing note')).toEqual(['trailing note']);
    expect(commentsIn('a.ts', '/** Doc block. */\nexport const x = 1;')).toEqual(['Doc block.']);
    expect(
      commentsIn('a.ts', 'const url = "https://example.com"; const glob = "**/*.ts";')
    ).toEqual([]);
    expect(
      commentsIn('a.ts', 'const re = /\\/\\/not-a-comment/g; const half = a / b / c;')
    ).toEqual([]);
    expect(commentsIn('a.ts', TEMPLATE_WITH_EXPRESSION)).toEqual(['inside']);
    expect(
      commentsIn('a.ts', '// biome-ignore lint/x: reason\n// @ts-expect-error reason')
    ).toEqual([]);
    expect(
      commentsIn('a.svelte', '<script>\n// in script\n</script>\n<!-- in markup -->\n<div></div>')
    ).toEqual(['in script', 'in markup']);
    expect(
      commentsIn('a.svelte', '<!-- svelte-ignore a11y_click_events_have_key_events -->')
    ).toEqual([]);
  },
});
