/**
 * 【文件】src/streaming/toolBlocks.mjs
 * 【职责】在 Char 回复预览链中解析工具调用定界符（成对 start/end），将未完成块渲染为占位、已完成块渲染为结果，并支持内联工具异步执行缓存。
 * 【原理】defineToolUseBlocks 用命名捕获组正则替换 content_for_show；defineInlineToolUses 对 content 中每个匹配 exec 一次并缓存 Promise/Error，pending 时显示「正在调用工具」；占位文案经 getChatI18n 按 html/markdown 能力分支。
 * 【数据结构】toolPairs/toolDefs、args.extension.streamInlineToolsResults（Map id→Promise[]）、CharReplyPreviewUpdater_t 链式 next。
 * 【关联】被 char 插件与其它 shell 直接 import；依赖 markdown.getChatI18n。
 */
import { escapeRegExp } from '../../../../../../scripts/regex.mjs'

import { getChatI18n } from './markdown.mjs'

/**
 * @param {object} args 预览参数
 * @returns {string} 占位符 HTML/Markdown/纯文本
 */
function renderToolCallingPlaceholder(args) {
	/**
	 * 获取本地化「正在调用工具」占位文案。
	 * @returns {string} 本地化文案
	 */
	const toolCallingText = () => getChatI18n(args, 'chat.message.view.commonToolCalling')
	if (args.supported_functions.html)
		return `\
<div class="tool-call-placeholder card my-2 bg-base-100 text-sm shadow-xl">
	<div class="card-body">
	${args.supported_functions.fount_i18nkeys
				? '<span class="tool-call-placeholder-text" data-i18n="chat.message.view.commonToolCalling"></span>'
				: `<span class="tool-call-placeholder-text">${toolCallingText()}</span>`}
	</div>
</div>
`
	if (args.supported_functions.markdown) return `*[[${toolCallingText()}]]*`
	return `(${toolCallingText()})`
}

/**
 * @param {...(string|RegExp)} specs 起止模式
 * @returns {string} 合并后的 flags
 */
function mergeToolBlockFlags(...specs) {
	let flags = ''
	for (const spec of specs)
		if (spec instanceof RegExp) flags += spec.flags
	return [...new Set(flags.split('').filter(flag => flag !== 'g' && flag !== 'y'))].join('')
}

/**
 * 判定工具块渲染结果是否为块级内容（含围栏代码块，或以块级 HTML 标签开头）。
 * @param {string} rendered 渲染结果
 * @returns {boolean} 是否块级
 */
function isBlockLevelRendered(rendered) {
	if (/```|~~~/.test(rendered)) return true
	return /^[ \t\r\n]*<(?:div|figure|details|blockquote|pre|table|ul|ol|h[1-6])[\s>]/i.test(rendered)
}

/**
 * 按需在替换点前后补空行，保证块级渲染结果落在行边界上。
 * 不补全时，围栏代码块 / 块级 HTML 会被拼接进段落行中，整段渲染随之损坏。
 * @param {string} display 原文
 * @param {number} index 匹配起点
 * @param {number} end 匹配终点
 * @param {string} rendered 渲染结果
 * @returns {string} 带行边界补全的替换文本
 */
function padBlockRendered(display, index, end, rendered) {
	if (!isBlockLevelRendered(rendered)) return rendered
	let padded = rendered
	if (index > 0 && display[index - 1] !== '\n') padded = `\n\n${padded}`
	if (end < display.length && display[end] !== '\n') padded += '\n\n'
	return padded
}

/**
 * @param {Array<{ start: string|RegExp, end: string|RegExp, renderPending?: Function, renderComplete?: Function }>} toolPairs 工具对
 * @returns {import('../../../../../../decl/chatLog.ts').CharReplyPreviewUpdater_t} 预览更新器
 */
export function defineToolUseBlocks(toolPairs) {
	return next => (args, reply) => {
		let display = reply.content_for_show ?? reply.content ?? ''
		for (const pair of toolPairs) {
			const pendingRenderer = pair.renderPending || ((...pendingArgs) => renderToolCallingPlaceholder(pendingArgs[1]))
			const completeRenderer = pair.renderComplete || pendingRenderer
			const startPattern = pair.start instanceof RegExp ? pair.start.source : escapeRegExp(pair.start)
			const endPattern = pair.end instanceof RegExp ? pair.end.source : escapeRegExp(pair.end)
			const blockFlags = mergeToolBlockFlags(pair.start, pair.end)
			const completeRegex = new RegExp(
				`(?<fountToolStart>${startPattern})(?<fountToolContent>[\\s\\S]*?)(?<fountToolEnd>${endPattern})`,
				`${blockFlags}g`,
			)
			const completeMatches = [...display.matchAll(completeRegex)]
			if (completeMatches.length) {
				let assembled = ''
				let lastIndex = 0
				for (const match of completeMatches) {
					const { groups } = match
					assembled += display.slice(lastIndex, match.index)
						+ padBlockRendered(display, match.index, match.index + match[0].length, completeRenderer(groups.fountToolContent, args, { groups }))
					lastIndex = match.index + match[0].length
				}
				display = assembled + display.slice(lastIndex)
			}
			const pendingMatch = new RegExp(
				`(?<fountToolStart>${startPattern})(?<fountToolContent>[\\s\\S]*)$`,
				blockFlags,
			).exec(display)
			if (pendingMatch) {
				const { groups } = pendingMatch
				const rendered = padBlockRendered(display, pendingMatch.index, display.length, pendingRenderer(groups.fountToolContent, args, { groups }))
				display = display.slice(0, pendingMatch.index) + rendered
			}
		}
		reply.content_for_show = display
		next?.(args, reply)
	}
}

/**
 * @param {Array<[string, string|RegExp, string|RegExp, Function, Function?]>} toolDefs 内联工具定义
 * @returns {import('../../../../../../decl/chatLog.ts').CharReplyPreviewUpdater_t} 预览更新器
 */
export function defineInlineToolUses(toolDefs) {
	return next => (args, reply) => {
		let display = reply.content_for_show ?? reply.content ?? ''
		args.extension ??= {}
		const cacheMap = args.extension.streamInlineToolsResults ??= {}

		for (const [id, start, end, exec, renderPending] of toolDefs) {
			const cache = cacheMap[id] ??= []
			const startPattern = start instanceof RegExp ? start.source : escapeRegExp(start)
			const endPattern = end instanceof RegExp ? end.source : escapeRegExp(end)
			const completeRegex = new RegExp(`(?<fountInlineStart>${startPattern})(?<fountInlineContent>[\\s\\S]*?)(?:${endPattern})`, 'g')
			const matches = [...reply.content.matchAll(completeRegex)]

			for (let index = 0; index < matches.length; index++) {
				const matchedContent = matches[index].groups.fountInlineContent
				if (!(index in cache)) cache[index] = (async () => {
					try { return cache[index] = await exec(matchedContent, args, { match: matches[index] }) }
					catch (error) { cache[index] = error }
				})()
			}
			if (matches.length < cache.length) cache.splice(matches.length)

			let matchIndex = 0
			const pendingRenderer = renderPending || ((...pendingArgs) => renderToolCallingPlaceholder(pendingArgs[1]))
			const displayMatches = [...display.matchAll(completeRegex)]
			if (displayMatches.length) {
				let assembled = ''
				let lastIndex = 0
				for (const match of displayMatches) {
					const item = cache[matchIndex++]
					const rendered = item instanceof Promise ? pendingRenderer(match.groups.fountInlineContent, args)
						: item instanceof Error ? `[Error: ${item.message}]`
							: String(item)
					assembled += display.slice(lastIndex, match.index)
						+ padBlockRendered(display, match.index, match.index + match[0].length, rendered)
					lastIndex = match.index + match[0].length
				}
				display = assembled + display.slice(lastIndex)
			}

			const pendingMatch = new RegExp(`(?:${startPattern})([\\s\\S]*)$`).exec(display)
			if (pendingMatch) {
				const rendered = padBlockRendered(display, pendingMatch.index, display.length, pendingRenderer(pendingMatch[1], args))
				display = display.slice(0, pendingMatch.index) + rendered
			}
		}

		reply.content_for_show = display
		next?.(args, reply)
	}
}
