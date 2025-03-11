import optimizeRegex from 'eslint-plugin-optimize-regex'
import UnusedImports from 'eslint-plugin-unused-imports'
import html from 'eslint-plugin-html'
import destructuringMerge from 'eslint-plugin-destructuring-merge'

export default [
	{
		plugins: {
			'optimize-regex': optimizeRegex,
			'unused-imports': UnusedImports,
			html,
			'destructuring-merge': destructuringMerge
		},
		files: ['**/*.html', '**/*.js', '**/*.mjs'],
		ignores: ['**/dist/*'],
		languageOptions: {
			ecmaVersion: 'latest',
		},
		rules: {
			// 移除多余的分号
			semi: [
				'error', 'never'
			],
			// 当块内容只有一行时，移除块的大括号
			curly: ['error', 'multi'],
			// tab 缩进
			indent: ['error', 'tab', {
				VariableDeclarator: 1,
				MemberExpression: 1,
				SwitchCase: 1,
				ignoredNodes: [
					'ConditionalExpression'
				]
			}],
			// 鼓励单引号
			quotes: ['error', 'single'],
			// 强制总是使用简写
			'object-shorthand': ['error', 'always'],
			'prefer-destructuring': ['warn', {
				'VariableDeclarator': {
					'array': true,
					'object': true
				},
				'AssignmentExpression': {
					'array': true,
					'object': true
				}
			}, {
				'enforceForRenamedProperties': true
			}],
			// 去除不必要小括号
			'no-extra-parens': ['error', 'all', {
				nestedBinaryExpressions: false, // 允许嵌套二元表达式中有括号
				returnAssign: false // 允许 return 语句中的赋值表达式中有括号
			}],
			// if中的没有await的promise
			'no-constant-condition': ['error', { checkLoops: false }],
			// 优化正则
			'optimize-regex/optimize-regex': 'warn',
			// 禁用未使用的导入
			'unused-imports/no-unused-imports': 'error',
			// 禁用未使用的变量
			'no-unused-vars': 'off',
			// 不要 var
			'no-var': 'error',
			// 偏好 const
			'prefer-const': ['error', {
				'destructuring': 'all',
				'ignoreReadBeforeAssign': true
			}],
			'destructuring-merge/destructuring-merge': 'warn'
		}
	}
]
