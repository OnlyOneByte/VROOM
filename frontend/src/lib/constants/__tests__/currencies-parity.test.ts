import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENCIES, NO_DECIMAL_CURRENCIES } from '../currencies';

const SHARED_CURRENCIES_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../backend/src/shared-currencies.json'
);

const SHARED = JSON.parse(readFileSync(SHARED_CURRENCIES_PATH, 'utf8')) as {
	currencies: string[];
	noDecimals: string[];
};

describe('currency list parity with the backend', () => {
	it('offers exactly the codes the settings API accepts', () => {
		expect([...CURRENCIES]).toEqual(SHARED.currencies);
	});

	it('treats exactly the backend no-decimal currencies as having no minor unit', () => {
		expect([...NO_DECIMAL_CURRENCIES]).toEqual(SHARED.noDecimals);
	});
});
