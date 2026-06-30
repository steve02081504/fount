/**
 * 共享 Markdown 处理器：按作者信任级别提供 unified pipeline（chat / social 共用）。
 */
import { GetMarkdownConvertor } from '/scripts/features/markdown/convertor.mjs'
import { loadRegisteredMarkdownExtensions } from '/scripts/features/markdown/extensions.mjs'

import { rehypeSanitizeUntrustedContent } from './fountMessageMarkdownPlugins.mjs'

/** @type {Map<string, import('npm:unified').Processor>} */
const processorCache = new Map()

/**
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @param {object} [options] 附加 remark 插件等选项
 * @param {import('npm:unified').Plugin[]} [options.extraRemarkPlugins] 调用方额外 remark 插件
 * @returns {Promise<import('npm:unified').Processor>} unified 处理器
 */
export async function getFountMessageMarkdownConvertor(isTrustedAuthorContent, { extraRemarkPlugins = [] } = {}) {
	const cacheKey = `${isTrustedAuthorContent ? 'trusted' : 'untrusted'}:${(await loadRegisteredMarkdownExtensions()).version}:${extraRemarkPlugins.map((p, i) => p?.name || p?.pluginName || `extra-${i}`).join(',')}`
	if (processorCache.has(cacheKey))
		return processorCache.get(cacheKey)

	const processor = await GetMarkdownConvertor({
		allowDangerousHtml: isTrustedAuthorContent,
		extraRemarkPlugins,
		extraRehypePlugins: isTrustedAuthorContent ? [] : [rehypeSanitizeUntrustedContent()],
	})
	processorCache.set(cacheKey, processor)
	return processor
}

/**
 * Markdown → HTML；不可信作者使用 allowDangerousHtml: false 的 pipeline。
 * @param {string} markdown 原文
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @param {object} [options] 同 getFountMessageMarkdownConvertor
 * @returns {Promise<string>} HTML
 */
export async function processFountMessageMarkdown(markdown, isTrustedAuthorContent, options = {}) {
	return String(await (await getFountMessageMarkdownConvertor(isTrustedAuthorContent, options)).process(markdown))
}
