import optimizeRegex from "eslint-plugin-optimize-regex"

export default [
	{
		plugins: {
			"optimize-regex": optimizeRegex
		},
		ignores: ["**/dist/*"],
		rules: {
			// 移除多余的分号
			semi: [
				"error", "never"
			],
			// 当块内容只有一行时，移除块的大括号
			curly: ["error", "multi"],
			// tab 缩进
			indent: ["error", "tab", {
				VariableDeclarator: 1,
				MemberExpression: 1,
				SwitchCase: 1,
				ignoredNodes: [
					'ConditionalExpression'
				]
			}],
			// 去除不必要小括号
			"no-extra-parens": ["error", "all", {
				"nestedBinaryExpressions": false, // 允许嵌套二元表达式中有括号
				"returnAssign": false // 允许 return 语句中的赋值表达式中有括号
			}],
			"optimize-regex/optimize-regex": "warn"
		}
	}
]
