/**
 * C247 source-scan guard — the reminder card stacks vertically on mobile so the title isn't occluded.
 *
 * A C247 eyes-on scout (seeded 3 reminders via the API + shot /reminders mobile + Read) found a real
 * NORTH_STAR #3 defect: the card's CardContent was a single `flex items-start justify-between` row with a
 * `min-w-0` title block beside a `flex-shrink-0` action cluster. For a mileage reminder that cluster is up
 * to 5 buttons (Serviced + Pause + edit + delete), so on a phone it claimed the full width and starved the
 * title to a ~1-character sliver ("Oil change" was unreadable). Fix: stack the title above the actions on
 * mobile (`flex-col`), going side-by-side only at `sm:` (`sm:flex-row sm:justify-between`), + let the action
 * cluster wrap on mobile (`flex-wrap sm:flex-nowrap`). Re-shot mobile → title fully readable, actions below.
 *
 * This pins the responsive stack so a refactor can't collapse back to the single-row layout (the unit suite
 * + a headless e2e don't measure occlusion). Source-scan of the route .svelte (no component-render harness).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', '+page.svelte'), 'utf8');

describe('reminder card mobile stack (C247 occlusion guard)', () => {
	test('the card CardContent stacks flex-col on mobile, flex-row only at sm:', () => {
		// The defining layout line: must start column (mobile) and only become a row at the sm breakpoint.
		expect(SRC).toMatch(/CardContent[\s\S]{0,120}flex flex-col/);
		expect(SRC).toMatch(/sm:flex-row/);
		expect(SRC).toMatch(/sm:justify-between/);
	});

	test('does NOT use an unconditional single-row justify-between on the card (the occluding layout)', () => {
		// The pre-fix class was `flex items-start justify-between gap-4 py-4` with no flex-col / sm: prefix.
		// Guard against its return: a CardContent whose class goes straight to a row + justify-between with
		// no flex-col anywhere would re-occlude the title behind the flex-shrink-0 action cluster.
		expect(SRC).not.toMatch(/CardContent class="flex items-start justify-between/);
	});

	test('the action cluster wraps on mobile (flex-wrap), nowrap only at sm:', () => {
		// The 5-button mileage action cluster must be allowed to reflow on a narrow phone row.
		expect(SRC).toMatch(/flex-wrap sm:flex-nowrap/);
	});
});
