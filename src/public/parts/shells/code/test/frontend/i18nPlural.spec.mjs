/**
 * 编辑器状态行的行数文案：源文案自带 `${count}`，计数由调用方传入，语言可自行选词形。
 * 浏览器里按语言取真实 bundle，验证 switch 叶子按 count 选分支、插值不残留占位符。
 */
import { test, expect } from './fixtures.mjs'

/**
 * 按语言解析 `code.explorer.lines`：加载该语言的真实 bundle 并按 count 取值。
 * @param {import('fount/scripts/test/playwright/module_page.mjs').ModulePage} modulePage 模块逻辑页
 * @param {string} locale locale id
 * @param {number[]} counts 待解析的计数
 * @returns {Promise<string[]>} 每个计数对应的文案
 */
function resolveLineLabels(modulePage, locale, counts) {
	return modulePage.run(async ({ locale, counts }) => {
		const i18n = await import('/scripts/i18n/index.mjs')
		const base = await import('/scripts/i18n/base.mjs')
		i18n.setI18nBundle(await base.loadLocaleData([locale]), locale, 'module', [locale])
		return counts.map(count => i18n.geti18n('code.explorer.lines', { count }))
	}, { locale, counts })
}

/** 每个语言必须给的词形（单数 / 复数 / 属格复数），不依赖某一种语言的规则。 */
const LOCALE_FORMS = [
	{ locale: 'zh-CN', cases: [[1, '1 行'], [3, '3 行'], [21, '21 行']] },
	{ locale: 'ja-JP', cases: [[1, '1 行'], [3, '3 行']] },
	{ locale: 'en-UK', cases: [[1, '1 line'], [3, '3 lines']] },
	{ locale: 'de-DE', cases: [[1, '1 Zeile'], [3, '3 Zeilen']] },
	{ locale: 'ru-RU', cases: [[1, '1 строка'], [3, '3 строк'], [11, '11 строк'], [21, '21 строка']] },
	{ locale: 'uk-UA', cases: [[1, '1 рядок'], [3, '3 рядків'], [11, '11 рядків'], [22, '22 рядків']] },
	{ locale: 'ar-SA', cases: [[1, '1 سطر'], [3, '3 أسطر']] },
	{ locale: 'is-IS', cases: [[1, '1 lína'], [3, '3 línur']] },
	{ locale: 'emoji', cases: [[1, '📄 1 🔢'], [3, '📄 3 🔢']] },
]

test('the editor line count picks the language\'s own number form through the i18n switch', async ({ modulePage }) => {
	for (const { locale, cases } of LOCALE_FORMS) {
		const labels = await resolveLineLabels(modulePage, locale, cases.map(([count]) => count))
		expect(labels, `${locale} line-count labels`).toEqual(cases.map(([, expected]) => expected))
		expect(labels.join(' '), `${locale} left a placeholder unresolved`).not.toContain('${')
	}
})
