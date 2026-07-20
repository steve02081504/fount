/**
 * 【文件】src/streaming/markdown.mjs
 * 【职责】为聊天流式/预览管线提供 Markdown 代码块与内联代码的安全渲染，以及基于用户 locale 的 i18n 文案读取。
 * 【原理】getSafeFence 按内容中反引号 run 长度选围栏；renderMarkdownCodeBlock 组合 lang/title info 字符串；inferCodeLanguageFromPath 经 lang-map 由扩展名推断高亮语言；getChatI18n 合并 args.locales 与 localhostLocales。
 * 【数据结构】fence 字符串、options `{ lang?, title? }`、LocaleKey、languageMap 查询结果。
 * 【关联】被 toolBlocks 与其它 shell 插件直接 import；依赖 scripts/i18n/bare.mjs。
 */
import languageMap from 'https://esm.sh/lang-map'

import { geti18nForLocales, localhostLocales } from '../../../../../../scripts/i18n/bare.mjs'

/**
 * 获取聊天相关的 i18n 文本。
 * @param {object} args 预览更新参数
 * @param {import('../../../../../../decl/locale_data.ts').LocaleKey} key i18n 键
 * @param {Record<string, unknown>} [params={}] 插值参数
 * @returns {string} 本地化文本
 */
export function getChatI18n(args, key, params = {}) {
	return geti18nForLocales(
		[...args.locales ?? [], ...localhostLocales],
		key,
		params,
	)
}

/**
 * @param {string} code 代码内容
 * @returns {string} Markdown 围栏
 */
function getSafeFence(code) {
	return '`'.repeat(1 + Math.max(
		2,
		...(String(code).match(/`+/g) || []).map(run => run.length),
	))
}

/**
 * @param {string} value 原始 info string 片段
 * @returns {string} 转义后片段
 */
function escapeMarkdownInfoStringValue(value) {
	return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * @param {string} filepath 文件路径
 * @returns {string} 高亮语言标识
 */
export function inferCodeLanguageFromPath(filepath) {
	const normalized = String(filepath || '').replace(/\\/g, '/')
	const filename = normalized.split('/').pop()?.toLowerCase() || ''
	const extension = filename.match(/\.(?<ext>[^.]+)$/)?.groups.ext || 'txt'
	return languageMap.languages(extension)?.[0]
}

/**
 * @param {string} code 代码内容
 * @param {{ lang?: string, title?: string }} [options] 渲染选项
 * @returns {string} Markdown 代码块
 */
export function renderMarkdownCodeBlock(code, options = {}) {
	const content = String(code ?? '')
	const fence = getSafeFence(content)
	const { lang = '', title = '' } = options
	const info = [
		lang.trim(),
		title ? `title="${escapeMarkdownInfoStringValue(title)}"` : '',
	].filter(Boolean).join(' ')
	return `${fence}${info ? info : ''}\n${content}\n${fence}`
}

/**
 * @param {string} code 单行代码
 * @param {string} [lang=''] 高亮语言
 * @returns {string} 内联代码
 */
export function renderMarkdownInlineCode(code, lang = '') {
	const escaped = String(code ?? '').replace(/`/g, '\\`')
	return `\`${escaped}${lang ? `{:${lang}}` : ''}\``
}
