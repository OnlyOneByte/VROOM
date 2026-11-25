import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const env = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/env', () => env);

import { handle, HSTS, PAGE_SECURITY_HEADERS } from '../hooks.server';

const event = {} as RequestEvent;

async function run(response: Response): Promise<Headers> {
	const res = await handle({ event, resolve: async () => response });
	return res.headers;
}

describe('server handle: page security headers', () => {
	test('every page gets frame, sniffing and referrer protection, plus HSTS in production', async () => {
		env.dev = false;
		const headers = await run(new Response('<html></html>'));
		for (const [name, value] of Object.entries(PAGE_SECURITY_HEADERS)) {
			expect(headers.get(name)).toBe(value);
		}
		expect(headers.get('X-Frame-Options')).toBe('DENY');
		expect(headers.get('Strict-Transport-Security')).toBe(HSTS);
	});

	test('the dev server gets no HSTS, so localhost is never pinned to https', async () => {
		env.dev = true;
		const headers = await run(new Response('ok'));
		expect(headers.get('Strict-Transport-Security')).toBeNull();
		expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
		env.dev = false;
	});

	test('a header a route already set is kept', async () => {
		const headers = await run(
			new Response('ok', { headers: { 'Referrer-Policy': 'no-referrer' } })
		);
		expect(headers.get('Referrer-Policy')).toBe('no-referrer');
	});
});

describe('content security policy', () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const config = readFileSync(resolve(here, '../../vite.config.ts'), 'utf8');
	const appHtml = readFileSync(resolve(here, '../app.html'), 'utf8');

	test('scripts are limited to this origin plus per-response nonces, and framing is refused', () => {
		expect(config).toMatch(/csp:\s*\{\s*mode: 'auto'/);
		expect(config).toContain("'script-src': ['self']");
		expect(config).toContain("'frame-ancestors': ['none']");
		expect(config).toContain("'object-src': ['none']");
	});

	test('every inline script in app.html carries the nonce placeholder', () => {
		const scripts = appHtml.match(/<script\b[^>]*>/g) ?? [];
		expect(scripts.length).toBeGreaterThan(0);
		for (const tag of scripts) expect(tag).toContain('nonce="%sveltekit.nonce%"');
	});
});
