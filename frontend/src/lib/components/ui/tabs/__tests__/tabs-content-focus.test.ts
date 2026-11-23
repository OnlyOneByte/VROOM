import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'tabs-content.svelte'),
	'utf8'
);

describe('TabsContent', () => {
	test('shows the kit focus ring when a keyboard user tabs onto the panel', () => {
		for (const cls of ['rounded-md', 'focus-visible:ring-ring/50', 'focus-visible:ring-[3px]']) {
			expect(source).toContain(cls);
		}
	});
});
