/**
 * i18n 未定义占位符：直接 geti18n 调用缺参时告警 `[i18n:missing]`（Playwright / output_filter 硬失败）。
 * 测试期间替换 console.warn 以捕获告警，避免触发 browser_diagnostics 的 i18nMissing 硬失败。
 */
import { test, expect } from './fixtures.mjs'

/**
 * 在模块页替换 console.warn 捕获一次 geti18n 调用的告警。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块页
 * @param {string} key i18n 键
 * @param {Record<string, unknown>} params 插值参数
 * @returns {Promise<string[]>} 捕获的 console.warn 文本
 */
function captureWarnings(modulePage, key, params) {
	return modulePage.run(async arg => {
		const { geti18n } = await import('/scripts/i18n/index.mjs')
		const captured = []
		const original = console.warn
		/**
		 * 记录一条 console.warn 文本。
		 * @param {...unknown} args 参数。
		 * @returns {void}
		 */
		function captureWarning(...args) { captured.push(args.join(' ')) }
		console.warn = captureWarning
		try {
			geti18n(arg.key, arg.params)
		}
		finally {
			console.warn = original
		}
		return captured
	}, { key, params })
}

test('geti18n warns [i18n:missing] when a placeholder is not provided', async ({ modulePage }) => {
	const warnings = await captureWarnings(modulePage, 'code.error.generic', {})
	expect(warnings.some(line => line.includes('[i18n:missing]') && line.includes('error'))).toBe(true)
})

test('geti18n stays silent when every placeholder is provided', async ({ modulePage }) => {
	const warnings = await captureWarnings(modulePage, 'code.error.generic', { error: 'boom' })
	expect(warnings).toEqual([])
})
