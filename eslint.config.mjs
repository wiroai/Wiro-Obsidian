import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default defineConfig([
	// Build output and the Node build scripts are not plugin code.
	globalIgnores([
		'node_modules',
		'main.js',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'eslint.config.mjs',
		'scripts',
	]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			// node:test returns a promise from test(); the runner awaits it.
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
]);
