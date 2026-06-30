/**
 * oklch() → `#rrggbb` hex conversion (#333 — the PWA `<meta name="theme-color">` tint).
 *
 * The theme tokens are authored in `oklch()` (app.css + the registry), but the PWA status-bar meta tag
 * needs a plain hex string: `theme-color` predates wide `oklch()` support in the browser-chrome parser, so
 * a raw `oklch(...)` in the meta is ignored by some platforms (the address bar falls back to white/black).
 * This converts the ACTIVE theme's surface token to a hex the chrome reliably honors.
 *
 * Pipeline (Björn Ottosson's OKLab, the same matrices the WCAG-contrast guard uses — kept in lockstep):
 *   oklch → OKLab → linear sRGB → gamma-encoded sRGB → clamp [0,1] → 8-bit hex.
 * The gamma step (absent in the contrast guard, which works in linear light for luminance) is what makes
 * this a DISPLAY color rather than a luminance input. Out-of-gamut channels are clamped, not errored — a
 * vivid token still yields its nearest in-gamut hex rather than breaking the tint.
 */

/** Parse an `oklch(L C H[/ a%])` string. Alpha is ignored (the status bar is opaque). Null if unparseable. */
function parseOklch(s: string): { L: number; C: number; H: number } | null {
	const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)/);
	if (!m) return null;
	return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Linear-light sRGB channel → gamma-encoded sRGB (the standard IEC 61966-2-1 transfer function). */
function linearToSrgb(x: number): number {
	const c = clamp01(x);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** An 8-bit channel (already 0..1) → a 2-char lowercase hex pair. */
function channelToHex(v: number): string {
	return Math.round(clamp01(v) * 255)
		.toString(16)
		.padStart(2, '0');
}

/**
 * Convert an `oklch(...)` string to `#rrggbb`. Returns null when the input is not a parseable oklch()
 * value, so callers can fall back to a safe default rather than emit a broken meta value.
 */
export function oklchToHex(oklch: string): string | null {
	const parsed = parseOklch(oklch);
	if (!parsed) return null;
	const { L, C, H } = parsed;

	// OKLCH → OKLab (polar → cartesian a/b).
	const h = (H * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	// OKLab → LMS' (cube of the linear LMS), then LMS → linear sRGB (Ottosson's matrices — IDENTICAL to
	// theme-contrast.test.ts so the tint and the contrast gate agree on what a token's color is).
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;

	const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

	return `#${channelToHex(linearToSrgb(rLin))}${channelToHex(linearToSrgb(gLin))}${channelToHex(linearToSrgb(bLin))}`;
}
