/**
 * Playwright 测试阶段配置。
 * @type {Array<{ name: string, testMatch: string[] }>}
 */
export const phases = [
	{ name: 'jsonEditor', testMatch: ['jsonEditor.spec.mjs'] },
]
