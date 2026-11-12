// Tailwind v4 runs through @tailwindcss/vite; the PostCSS plugin breaks @import 'tailwindcss' under Vite 8.
export default {
	plugins: {
		autoprefixer: {}
	}
};
