/**
 * Shared test helper: recursively collect every `.svelte` file under a root, skipping
 * node_modules + .svelte-kit. ONE source of truth for the source-scan GUARD suite —
 * no-hardcoded-currency, no-interpolated-arbitrary-class, no-theme-clashing-colors, and
 * fab-bottom-clearance each re-declared this byte-identical walker (C275 rule-of-four dedup;
 * the C271 dark-clash guard tipped it past the rule-of-three bar). The caller keeps its own
 * SRC_ROOT (it depends on each test file's own import.meta.url depth) and passes it in.
 *
 * Pure + dependency-free (node:fs/node:path only) so it loads in the fast unit suite with no
 * browser/server. Not a `.test.ts` — it exports a helper, it doesn't declare tests.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export function collectSvelteFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			collectSvelteFiles(full, acc);
		} else if (entry.name.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}
