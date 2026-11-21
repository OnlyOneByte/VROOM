import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const APP_CSS = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app.css'),
	'utf8'
);

describe('app.css leaves the screen-reader utilities to Tailwind', () => {
	test.each(['sr-only', 'not-sr-only'])(
		'does not redefine .%s, which would outrank its responsive variants',
		utility => {
			expect(APP_CSS).not.toMatch(new RegExp(`(^|[\\s,}])\\.${utility}\\s*[{,]`, 'm'));
			expect(APP_CSS).not.toMatch(new RegExp(`@utility\\s+${utility}\\s*\\{`));
		}
	);
});
