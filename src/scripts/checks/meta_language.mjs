/**
 * 完整 HTML 文档 head 元数据的语言检查：og / description 不得含中文；`<title>` 非空时同样不得含中文，为空时必须由 i18n 提供标题，且该 key 的 `.description` 在 en-UK 与 HTML 的 description / og:description 三者一致。
 */
import { parseHTML } from 'npm:linkedom'

import { isFullHtmlDocument } from './html_meta.mjs'

/**
 * 页面 id 的参照 locale：空 `<title>` 的 `.description` 必须与 HTML 元数据逐字相同。
 * en-UK 是 `getLocaleData` 的兜底 locale，也是 `update-locales.py` 的源语言。
 */
export const META_REFERENCE_LOCALE = 'en-UK'

/** 页面 id 取自 `<title data-i18n="…">`，或同目录 JS 里的 `initTranslations('…')`。 */
export const INIT_TRANSLATIONS_CALL = /initTranslations\(\s*['"`](?<pageid>[\w-]+)['"`]/u

/**
 * 禁止出现在面向搜索引擎的元数据里的文字系统：汉字、假名、西里尔字母。
 * 韩文谚文（Hangul）不在内——它不表示中文，且本项目没有韩文元数据先例。
 */
export const FORBIDDEN_META_SCRIPT = /[\u3006\u3007\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u0400-\u052f]/

/**
 * 检查单个文本是否命中禁用文字系统。
 * @param {string | null | undefined} text 待检查文本
 * @returns {boolean} 命中则为 true
 */
export function hasForbiddenScript(text) {
	return !!text && FORBIDDEN_META_SCRIPT.test(text)
}

/**
 * 按 `a.b.c` 取 locale 叶子。
 * @param {unknown} localeData 已解析的 locale JSON
 * @param {string} key 点分键
 * @returns {unknown} 叶子；路径缺失时为 undefined
 */
export function resolveLocaleLeaf(localeData, key) {
	return key.split('.').reduce((node, part) => node?.[part], localeData)
}

/**
 * 从 `<title>` 的 `data-i18n` 或同目录脚本的 `initTranslations` 取页面 id。
 * @param {Element | null} titleElement `<title>` 元素
 * @param {string[]} scripts 同目录候选脚本源码
 * @returns {string} 页面 id；找不到时为空串
 */
export function resolvePageId(titleElement, scripts = []) {
	const attributeKey = titleElement?.getAttribute('data-i18n')?.trim() ?? ''
	if (attributeKey) return attributeKey.replace(/\.title$/u, '')

	for (const source of scripts) {
		const match = source.match(INIT_TRANSLATIONS_CALL)
		if (match) return match.groups.pageid
	}
	return ''
}

/**
 * 描述问题：要求把元数据写成充满诗意的英文。
 * @param {string} field 字段名
 * @param {string} text 违规文本
 * @returns {string} 供测试失败信息直接拼接的一行
 */
export function describeNonEnglish(field, text) {
	return `${field} 出现中文（或日文假名 / 西里尔字母）：${JSON.stringify(text)}。请改写成充满诗意的英文，不能保留中文。`
}

/**
 * 描述问题：空 `<title>` 缺少 i18n 来源。
 * @returns {string} 供测试失败信息直接拼接的一行
 */
export function describeMissingPageId() {
	return '<title> 为空时必须由 i18n 提供标题：`<title data-i18n="<pageid>.title">` 或同目录脚本的 `initTranslations(\'<pageid>\')`，两者都没有。'
}

/**
 * 描述问题：i18n 的 `.description` 与 HTML 元数据不一致。
 * @param {string} key `.description` 键
 * @param {unknown} localeValue en-UK 中的值
 * @param {string} htmlDescription `name="description"` 的值
 * @param {string} ogDescription `og:description` 的值
 * @returns {string} 供测试失败信息直接拼接的一行
 */
export function describeDescriptionDrift(key, localeValue, htmlDescription, ogDescription) {
	const localePart = localeValue === undefined
		? `${META_REFERENCE_LOCALE} 缺少 ${key}`
		: `${META_REFERENCE_LOCALE} 的 ${key} 为 ${JSON.stringify(localeValue)}`
	return `空 <title> 页面的 ${key} 必须与 HTML 的 description、og:description 三者逐字相同：${localePart}；HTML description 为 ${JSON.stringify(htmlDescription)}；og:description 为 ${JSON.stringify(ogDescription)}。`
}

/**
 * 检查一份页面的 head 元数据。
 * 空 `<title>` 走「i18n 标题 + `.description` 三方一致」；非空 `<title>` 只要求不含中文。
 * @param {{ pageId: string, title: string, htmlDescription: string, ogDescription: string, ogTitle: string, localeData: unknown }} page 页面元数据
 * @returns {string[]} 问题列表
 */
export function inspectPageMeta(page) {
	const { pageId, title, htmlDescription, ogDescription, localeData } = page

	const issues = [
		['og:title', page.ogTitle],
		['og:description', ogDescription],
		['description', htmlDescription],
	].flatMap(([field, value]) => hasForbiddenScript(value) ? [describeNonEnglish(field, value)] : [])

	if (title !== '') {
		if (hasForbiddenScript(title))
			issues.push(describeNonEnglish('<title>', title))
		return issues
	}

	if (!pageId) {
		issues.push(describeMissingPageId())
		return issues
	}

	const titleKey = `${pageId}.title`
	const descriptionKey = `${pageId}.description`
	const localeDescription = resolveLocaleLeaf(localeData, descriptionKey)
	if (localeDescription !== htmlDescription || localeDescription !== ogDescription)
		issues.push(describeDescriptionDrift(descriptionKey, localeDescription, htmlDescription, ogDescription))

	if (typeof resolveLocaleLeaf(localeData, titleKey) !== 'string')
		issues.push(`${META_REFERENCE_LOCALE} 缺少页面 id 的标题键 ${titleKey}——空 <title> 必须由 i18n 提供标题。`)

	return issues
}

/**
 * 从已解析的 DOM 文档检查 head 元数据。
 * @param {Document} document 解析后的 HTML 文档
 * @param {{ scripts?: string[], localeData?: unknown }} [context] 同目录脚本源码与参照 locale 数据
 * @returns {string[]} 问题列表；无 `head` 时为空
 */
export function inspectMetaLanguageFromDocument(document, context = {}) {
	const head = document.querySelector('head')
	if (!head) return []

	const titleElement = head.querySelector('title')
	return inspectPageMeta({
		pageId: resolvePageId(titleElement, context.scripts),
		title: titleElement?.textContent?.trim() ?? '',
		htmlDescription: head.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
		ogDescription: head.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ?? '',
		ogTitle: head.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ?? '',
		localeData: context.localeData,
	})
}

/**
 * 从 HTML 文本检查 head 元数据。
 * 非完整文档跳过；完整文档没有 `head` 时也算跳过（元数据存在性由 `html_meta` 负责）。
 * @param {string} content HTML 文本
 * @param {{ scripts?: string[], localeData?: unknown }} [context] 同目录脚本源码与参照 locale 数据
 * @returns {{ skipped: true } | { skipped: false, issues: string[] }} 跳过或问题列表
 */
export function inspectMetaLanguage(content, context = {}) {
	if (!isFullHtmlDocument(content))
		return { skipped: true }
	const { document } = parseHTML(content)
	return { skipped: false, issues: inspectMetaLanguageFromDocument(document, context) }
}
