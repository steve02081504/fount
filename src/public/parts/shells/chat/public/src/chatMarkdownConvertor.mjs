/**
 * 【文件】public/src/chatMarkdownConvertor.mjs
 * 【职责】按作者信任级别提供 unified Markdown 处理器（扩展经全局 registry 加载）。
 */
import { getFountMessageMarkdownConvertor, processFountMessageMarkdown } from '/scripts/fountMessageMarkdown.mjs'

/**
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @returns {Promise<import('npm:unified').Processor>}
 */
export async function getChatMarkdownConvertor(isTrustedAuthorContent) {
	return getFountMessageMarkdownConvertor(isTrustedAuthorContent)
}

/**
 * @param {string | { value?: string, data?: object }} markdown 原文或 vfile
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @returns {Promise<string>} HTML
 */
export async function processChatMarkdown(markdown, isTrustedAuthorContent) {
	const text = typeof markdown === 'string' ? markdown : markdown?.value ?? ''
	if (typeof markdown === 'object' && markdown?.data) {
		const processor = await getChatMarkdownConvertor(isTrustedAuthorContent)
		const file = await processor.process(markdown)
		return String(file)
	}
	return processFountMessageMarkdown(text, isTrustedAuthorContent)
}
