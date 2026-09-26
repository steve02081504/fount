import { defineReplyHandler } from '../../shells/chat/src/reply/defineReplyHandler.mjs'
import { renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'

import { MarkdownWebFetch } from './fetch.mjs'

/**
 * 解析 `<web-browse>` 调用内的 URL 与问题。
 * @param {string} inner - 调用体内文本。
 * @returns {{ url?: string, question?: string }} 解析结果。
 */
export function parseWebBrowseCall(inner) {
	const url = inner.match(/<url>([\S\s]*?)<\/url>/)?.[1]?.trim()
	const question = inner.match(/<question>([\S\s]*?)<\/question>/)?.[1]?.trim()
	return { url, question }
}

/**
 * 将网页正文与问题组装为角色可读的工具结果。
 * @param {string} url - 网页地址。
 * @param {string} markdown - 网页正文。
 * @param {string} [question] - 针对网页的问题。
 * @returns {string} 工具结果文本。
 */
export function formatWebBrowseResult(url, markdown, question) {
	let text = `网页 ${url} 的内容：\n${markdown}`
	if (question) text += `\n\n请根据以上网页内容回答：\n${question}`
	return text
}

/**
 * 创建网页浏览工具处理器。
 * @param {object} [options] - 依赖项。
 * @param {(url: string) => Promise<string>} [options.fetchMarkdown] - 抓取网页并转换为 Markdown。
 * @returns {import('../../../../decl/pluginAPI.ts').ReplyHandler_t} 网页浏览回复处理器。
 */
export function createWebBrowseReplyHandler({ fetchMarkdown = MarkdownWebFetch } = {}) {
	return defineReplyHandler({
		tag: 'web-browse',
		name: 'web-browse.browse',
		/**
		 * 抓取网页并把正文写入工具日志，要求模型据此作答。
		 * @param {object} _reply - 当前回复。
		 * @param {object} args - 回复请求上下文。
		 * @param {object} call - 已解析的工具调用。
		 * @returns {Promise<{regen: boolean}>} 要求模型根据网页内容继续生成。
		 */
		handle: async (_reply, args, call) => {
			/**
			 * 追加一条人类展示层安全的工具日志。
			 * @param {string} content - 提供给角色的日志正文。
			 * @param {string} [contentForShow=content] - 人类展示层正文。
			 * @returns {void}
			 */
			const addToolLog = (content, contentForShow = content) => args.AddLongTimeLog?.({
				name: 'web-browse.browse',
				role: 'tool',
				content,
				content_for_show: renderMarkdownCodeBlock(contentForShow),
				files: [],
			})

			const { url, question } = parseWebBrowseCall(String(call?.inner ?? ''))
			if (!url) {
				addToolLog('网页浏览指令 <web-browse> 内未找到 <url> 标签。')
				return { regen: true }
			}

			console.info('AI 浏览网页：', url)
			try {
				const markdown = await fetchMarkdown(url)
				addToolLog(formatWebBrowseResult(url, markdown, question))
			}
			catch (error) {
				console.error('web browse failed:', error)
				const message = error?.stack || error?.message || String(error)
				addToolLog(`浏览网页“${url}”时出现错误：\n${message}`)
			}
			return { regen: true }
		},
	})
}
