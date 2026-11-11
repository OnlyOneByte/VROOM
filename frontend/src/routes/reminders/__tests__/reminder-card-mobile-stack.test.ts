// Source-scan guard: on mobile the title must stack above its actions, or it is occluded.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

describe('reminder card mobile stack (occlusion guard)', () => {
	test('the card CardContent stacks flex-col on mobile, flex-row only at sm:', () => {
		expect(SRC).toMatch(/CardContent[\s\S]{0,120}flex flex-col/);
		expect(SRC).toMatch(/sm:flex-row/);
		expect(SRC).toMatch(/sm:justify-between/);
	});

	test('does NOT use an unconditional single-row justify-between on the card (the occluding layout)', () => {
		// Guards against a single-row justify-between layout, which starves the title on phones.
		expect(SRC).not.toMatch(/CardContent class="flex items-start justify-between/);
	});

	test('the action cluster wraps on mobile (flex-wrap), nowrap only at sm:', () => {
		// The action cluster must wrap on narrow phones.
		expect(SRC).toMatch(/flex-wrap sm:flex-nowrap/);
	});
});
