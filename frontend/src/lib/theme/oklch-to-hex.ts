function parseOklch(s: string): { L: number; C: number; H: number } | null {
	const m = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)/);
	if (!m) return null;
	return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function linearToSrgb(x: number): number {
	const c = clamp01(x);
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function channelToHex(v: number): string {
	return Math.round(clamp01(v) * 255)
		.toString(16)
		.padStart(2, '0');
}

export function oklchToHex(oklch: string): string | null {
	const parsed = parseOklch(oklch);
	if (!parsed) return null;
	const { L, C, H } = parsed;

	const h = (H * Math.PI) / 180;
	const a = C * Math.cos(h);
	const b = C * Math.sin(h);

	// Ottosson matrices; must match theme-contrast.test.ts so the tint and contrast gate agree.
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
