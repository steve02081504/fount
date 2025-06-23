import optimizeRegex from 'npm:eslint-plugin-optimize-regex'
import UnusedImports from 'npm:eslint-plugin-unused-imports'
import html from 'npm:eslint-plugin-html'
import destructuringMerge from 'npm:eslint-plugin-destructuring-merge'
import removeDuplicates from 'npm:eslint-plugin-remove-duplicates'
import tseslint from 'npm:typescript-eslint'

const commonPlugins = {
	'optimize-regex': optimizeRegex,
	'unused-imports': UnusedImports,
	'destructuring-merge': destructuringMerge,
	'remove-duplicates': removeDuplicates,
}

const commonRules = {
	'remove-duplicates/remove-array-duplicates': ['error'],
	semi: ['error', 'never'],
	'no-duplicate-imports': ['error'],
	curly: ['error', 'multi'],
	indent: ['error', 'tab', {
		VariableDeclarator: 1,
		MemberExpression: 1,
		SwitchCase: 1,
		ignoredNodes: ['ConditionalExpression'],
	}],
	quotes: ['error', 'single'],
	'object-shorthand': ['error', 'always'],
	'prefer-destructuring': ['warn', {
		VariableDeclarator: { array: true, object: true },
		AssignmentExpression: { array: true, object: true },
	}, {
		enforceForRenamedProperties: true,
	}],
	'no-extra-parens': ['error', 'all', {
		nestedBinaryExpressions: false,
		returnAssign: false,
	}],
	'no-constant-condition': ['error', { checkLoops: false }],
	'optimize-regex/optimize-regex': 'warn',
	'unused-imports/no-unused-imports': 'error',
	'no-unused-vars': 'off',
	'no-var': 'error',
	'prefer-const': ['error', {
		destructuring: 'all',
		ignoreReadBeforeAssign: true,
	}],
	'destructuring-merge/destructuring-merge': 'warn',
}

export default [
	{
		ignores: ['**/dist/*'],
	},
	{
		files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.html'],
		plugins: {
			...commonPlugins,
			html,
		},
		languageOptions: {
			ecmaVersion: 'latest',
		},
		rules: commonRules,
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			...commonPlugins,
			'@typescript-eslint': tseslint.plugin,
		},
		languageOptions: {
			ecmaVersion: 'latest',
			parser: tseslint.parser,
		},
		rules: {
			...commonRules,
			'no-extra-parens': 'off',
			'@typescript-eslint/no-unused-vars': 'error',
		},
	},
]
