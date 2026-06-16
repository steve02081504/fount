/**
 * 共享 Markdown 处理器：按作者信任级别提供 unified pipeline（chat / social 共用）。
 */
import { GetMarkdownConvertor } from './markdownConvertor.mjs'

/** @type {Map<string, import('npm:unified').Processor>} */
const processorCache = new Map()

/**
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @param {object} [options] 附加 remark 插件等选项
 * @param {import('npm:unified').Plugin[]} [options.extraRemarkPlugins] shell 专用 remark 插件
 * @returns {Promise<import('npm:unified').Processor>} unified 处理器
 */
export async function getFountMessageMarkdownConvertor(isTrustedAuthorContent, options = {}) {
	const extraRemarkPlugins = options.extraRemarkPlugins || []
	const cacheKey = `${isTrustedAuthorContent ? 'trusted' : 'untrusted'}:${extraRemarkPlugins.length}`
	if (processorCache.has(cacheKey))
		return processorCache.get(cacheKey)

	const processor = await GetMarkdownConvertor({
		allowDangerousHtml: isTrustedAuthorContent,
		extraRemarkPlugins,
		extraRehypePlugins: [],
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
	const processor = await getFountMessageMarkdownConvertor(isTrustedAuthorContent, options)
	const file = await processor.process(markdown ?? '')
	return String(file)
}
