/**
 * Playwright 测试阶段配置。
 * @type {Array<{ name: string, testMatch: string[] }>}
 */
export const phases = [
	{ name: 'smoke', testMatch: ['smoke.spec.mjs', 'ui.spec.mjs'] },
]
