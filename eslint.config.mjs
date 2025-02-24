import eslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2018,
				sourceType: 'module'
			},
		},
		plugins: {
			'@typescript-eslint': eslint
		},
		rules: {
			...eslint.configs.recommended.rules
		}
	}
];
