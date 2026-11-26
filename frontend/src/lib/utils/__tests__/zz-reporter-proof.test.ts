import { expect, test } from 'vitest';

test('reporter proof: this deliberately failing test must be named in the CI log', () => {
	expect(1 + 1).toBe(3);
});
