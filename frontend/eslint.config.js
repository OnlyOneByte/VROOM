import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const chartsBarrelSpecifiers = ['#lib/components/charts', '../charts', '../../charts'];
const restrictedChartsBarrelPaths = chartsBarrelSpecifiers.map(name => ({
	name,
	allowImportNames: ['AppLineChart', 'AppBarChart', 'AppPieChart', 'AppAreaChart'],
	message:
		'The charts barrel drags layerchart + d3 into the route chunk. Import chart-free components directly, e.g. `import StatCardGrid from "#lib/components/charts/StatCardGrid.svelte"`.'
}));

export default [
	js.configs.recommended,
	{
		ignores: ['.svelte-kit/**', 'build/**', 'dist/**', 'node_modules/**', 'static/sw.js']
	},
	{
		files: ['src/service-worker/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.serviceworker,
				ServiceWorkerGlobalScope: 'readonly',
				PushEvent: 'readonly',
				NotificationEvent: 'readonly',
				WindowClient: 'readonly'
			}
		}
	},
	{
		files: ['**/*.{js,ts,mjs}'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module'
			},
			globals: {
				...globals.browser,
				...globals.node,
				...globals.es2020,
				$state: 'readonly',
				$derived: 'readonly',
				$effect: 'readonly',
				$props: 'readonly',
				$bindable: 'readonly',
				$inspect: 'readonly'
			}
		},
		plugins: {
			'@typescript-eslint': ts
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'@typescript-eslint/no-explicit-any': 'warn',
			'no-console': 'off',
			'no-debugger': 'error',
			'prefer-const': 'error',
			'no-var': 'error',
			'no-unused-vars': 'off'
		}
	},
	...svelte.configs['flat/recommended'],
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tsParser,
				extraFileExtensions: ['.svelte']
			},
			globals: {
				...globals.browser,
				...globals.es2020
			}
		},
		plugins: {
			'@typescript-eslint': ts
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'no-console': 'off',
			'svelte/valid-compile': [
				'error',
				{
					ignoreWarnings: true
				}
			]
		}
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module'
			},
			globals: {
				...globals.browser,
				...globals.es2020,
				$state: 'readonly',
				$derived: 'readonly',
				$effect: 'readonly',
				$props: 'readonly',
				$bindable: 'readonly',
				$inspect: 'readonly'
			}
		},
		plugins: {
			'@typescript-eslint': ts
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_'
				}
			],
			'no-unused-vars': 'off',
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.{js,ts,mjs,svelte}'],
		rules: {
			'no-restricted-imports': ['error', { paths: restrictedChartsBarrelPaths }]
		}
	},
	{
		files: ['src/lib/components/ui/**/*.svelte'],
		rules: {
			'svelte/require-each-key': 'off',
			'svelte/no-at-html-tags': 'off',
			'svelte/valid-compile': 'off',
			'svelte/no-navigation-without-resolve': 'off',
			'no-useless-assignment': 'off'
		}
	},
	{
		files: ['**/*.test.{js,ts}', '**/__tests__/**/*.{js,ts}'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				...globals.es2020,
				vi: 'readonly',
				describe: 'readonly',
				it: 'readonly',
				test: 'readonly',
				expect: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				beforeAll: 'readonly',
				afterAll: 'readonly'
			}
		},
		plugins: {
			'@typescript-eslint': ts
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off'
		}
	},
	prettier
];
