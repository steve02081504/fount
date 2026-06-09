/**
 * 【文件】public/src/chatMarkdownConvertor.mjs
 * 【职责】按作者信任级别提供 unified Markdown 处理器（可信/不可信两套 pipeline）。
 * 【原理】委托 pages/scripts/fountMessageMarkdown；附加 remarkExpandChannelLinks。
 */
import { getFountMessageMarkdownConvertor, processFountMessageMarkdown } from '/scripts/fountMessageMarkdown.mjs'

import { remarkExpandChannelLinks } from './chatMarkdownPlugins.mjs'

const CHAT_MARKDOWN_OPTIONS = { extraRemarkPlugins: [remarkExpandChannelLinks] }

/**
 * 获取聊天消息 Markdown 转换器（可信 / 不可信各缓存一份）。
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @returns {Promise<import('npm:unified').Processor>} 缓存的 unified 处理器
 */
export async function getChatMarkdownConvertor(isTrustedAuthorContent) {
	return getFountMessageMarkdownConvertor(isTrustedAuthorContent, CHAT_MARKDOWN_OPTIONS)
}

/**
 * Markdown → HTML（不可信作者 pipeline 禁用 allowDangerousHtml）。
 * @param {string} markdown 原文
 * @param {boolean} isTrustedAuthorContent 是否来自已信任作者
 * @returns {Promise<string>} HTML
 */
export async function processChatMarkdown(markdown, isTrustedAuthorContent) {
	return processFountMessageMarkdown(markdown, isTrustedAuthorContent, CHAT_MARKDOWN_OPTIONS)
}
