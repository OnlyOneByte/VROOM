import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Dial from '../Dial.svelte';

const SOURCE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), '..', 'Dial.svelte'),
	'utf8'
);

const LABEL = 'True cost per mile, all in: 58 cents; running 13, loan and insurance 45';

function mount(running: number, ownership: number, max?: number) {
	return render(Dial, {
		props: {
			running,
			ownership,
			valueLabel: `${Math.round(running + ownership)}¢`,
			caption: 'ALL-IN ¢ / MI',
			label: LABEL,
			...(max !== undefined && { max })
		}
	});
}

function needleTip(container: HTMLElement): [number, number] {
	const line = container.querySelector('[data-slot="dial-needle"] line')!;
	return [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))];
}

function needleAngle(container: HTMLElement): number {
	const [x, y] = needleTip(container);
	return (Math.atan2(110 - y, x - 110) * 180) / Math.PI;
}

afterEach(() => cleanup());

describe('Dial', () => {
	test('is one image with the full sentence as its label, and shows the caption and value', () => {
		mount(13, 45);
		const dial = screen.getByRole('img', { name: LABEL });
		expect(dial.tagName.toLowerCase()).toBe('svg');
		expect(dial).toHaveTextContent('ALL-IN ¢ / MI');
		expect(dial).toHaveTextContent('58¢');
	});

	test('labels 0, 20, 40, 60 and 80 on a 270° sweep', () => {
		const { container } = mount(13, 45);
		const numbers = [...container.querySelectorAll('text.dial-figure')].map(t => t.textContent);
		expect(numbers).toEqual(['0', '20', '40', '60', '80']);
		expect(container.querySelectorAll('line.stroke-foreground')).toHaveLength(17);
	});

	test('the needle points at the all-in value', () => {
		const { container } = mount(13, 45);
		expect(needleAngle(container)).toBeCloseTo(225 - (270 * 58) / 80, 1);
	});

	test('running and ownership are two arcs that meet at the running value', () => {
		const { container } = mount(13, 45);
		const running = container.querySelector('[data-arc="running"]')!.getAttribute('d')!;
		const ownership = container.querySelector('[data-arc="ownership"]')!.getAttribute('d')!;
		const runningEnd = running.split(' ').at(-1);
		expect(ownership.startsWith(`M${runningEnd}`)).toBe(true);
		expect(running).toMatch(/^M47\.77,172\.23 /);
	});

	test('a value past the scale pegs the needle at the end, and the label keeps the real value', () => {
		const { container } = mount(30, 90);
		expect(needleAngle(container)).toBeCloseTo(-45, 1);
		expect(screen.getByRole('img')).toHaveTextContent('120¢');
	});

	test('negative or missing values rest the needle at zero and draw no arc', () => {
		const { container } = mount(-5, Number.NaN);
		expect(needleAngle(container)).toBeCloseTo(-135, 1);
		expect(container.querySelector('[data-arc]')).toBeNull();
	});

	test('a running-only cost draws no ownership arc', () => {
		const { container } = mount(20, 0);
		expect(container.querySelector('[data-arc="running"]')).not.toBeNull();
		expect(container.querySelector('[data-arc="ownership"]')).toBeNull();
	});

	test('the scale follows a custom maximum', () => {
		const { container } = mount(10, 10, 40);
		const numbers = [...container.querySelectorAll('text.dial-figure')].map(t => t.textContent);
		expect(numbers).toEqual(['0', '10', '20', '30', '40']);
		expect(needleAngle(container)).toBeCloseTo(225 - (270 * 20) / 40, 1);
	});

	test('the needle settles only when motion is allowed, within 400 ms', () => {
		const media = SOURCE.indexOf('@media (prefers-reduced-motion: no-preference)');
		const animation = SOURCE.indexOf('animation: dial-settle 400ms');
		expect(media).toBeGreaterThan(-1);
		expect(animation).toBeGreaterThan(media);
		expect(SOURCE.match(/animation:/g)).toHaveLength(1);
	});
});
