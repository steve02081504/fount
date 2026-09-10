/**
 * Playwright 测试阶段配置。
 * @type {Array<{ name: string, testMatch: string[] }>}
 */
export const phases = [
	{ name: 'smoke', testMatch: ['smoke.spec.mjs'] },
	{ name: 'source_plugins', testMatch: ['source_plugins.spec.mjs'] },
	{ name: 'edit_security', testMatch: ['edit_security.spec.mjs'] },
	{ name: 'selection_controller', testMatch: ['selection_controller.spec.mjs'] },
]
