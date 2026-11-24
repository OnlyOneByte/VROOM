type Load = () => Promise<unknown>;

function whenIdle(callback: () => void): void {
	if (typeof requestIdleCallback === 'function') requestIdleCallback(callback, { timeout: 3000 });
	else setTimeout(callback, 50);
}

export function loadWhenIdle(loads: Load[]): void {
	const next = (index: number) => {
		const load = loads[index];
		const advance = () => next(index + 1);
		if (load) whenIdle(() => void load().then(advance, advance));
	};
	next(0);
}
