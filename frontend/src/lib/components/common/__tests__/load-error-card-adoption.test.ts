import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const NOT_A_LOAD_CARD: Record<string, number> = {
	'lib/components/common/media/CameraTab.svelte': 1,
	'lib/components/expenses/form/ExpenseForm.svelte': 1,
	'lib/components/sync/OfflineIndicator.svelte': 1,
	'routes/+error.svelte': 1
};

const NOT_YET_MOVED: Record<string, number> = {
	'lib/components/expenses/ImportFromPhotosDialog.svelte': 1,
	'lib/components/settings/cards/StorageProvidersCard.svelte': 1,
	'lib/components/vehicles/FinanceTab.svelte': 1,
	'lib/components/vehicles/form/VehicleForm.svelte': 1,
	'routes/settings/+page.svelte': 1,
	'routes/settings/providers/[id]/edit/+page.svelte': 1
};

const RETRY_WINDOW = 30;

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === '__tests__' ? [] : svelteFiles(path);
		return path.endsWith('.svelte') ? [path] : [];
	});
}

function alertWithRetryCount(source: string): number {
	const lines = source.split('\n');
	return lines.filter(
		(line, i) =>
			line.includes('<CircleAlert') &&
			/>\s*Retry\b|^\s*Retry\s*$/m.test(lines.slice(i, i + RETRY_WINDOW).join('\n'))
	).length;
}

describe('load failures use LoadErrorCard', () => {
	test('no file hand-writes another CircleAlert + Retry block', () => {
		const counts = Object.fromEntries(
			svelteFiles(SRC)
				.filter(path => !path.endsWith('LoadErrorCard.svelte'))
				.map(
					path => [relative(SRC, path), alertWithRetryCount(readFileSync(path, 'utf8'))] as const
				)
				.filter(([, count]) => count > 0)
		);

		expect(counts).toEqual({ ...NOT_A_LOAD_CARD, ...NOT_YET_MOVED });
	});
});
