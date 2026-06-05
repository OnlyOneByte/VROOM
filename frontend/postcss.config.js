export default {
	plugins: {
		// Tailwind v4 is handled by the @tailwindcss/vite plugin (see vite.config.ts),
		// not the PostCSS plugin — the latter breaks @import 'tailwindcss' resolution
		// under Vite 8.
		autoprefixer: {}
	}
};
