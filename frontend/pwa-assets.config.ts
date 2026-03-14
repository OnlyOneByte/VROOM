import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
	headLinkOptions: {
		preset: '2023'
	},
	preset: {
		...minimal2023Preset,
		favicon: {
			sizes: [48],
			resizeOptions: { background: 'transparent' }
		}
	},
	images: ['static/favicon.svg']
});
