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
