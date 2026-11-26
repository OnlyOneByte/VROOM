import { SvelteURL } from 'svelte/reactivity';

export const page = $state({ url: new SvelteURL('https://vroom.test/analytics') as URL });
