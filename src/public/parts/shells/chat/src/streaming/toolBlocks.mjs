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
	const toolCallingText = () => getChatI18n(args, 'chat.messageView.commonToolCalling')
	if (args.supported_functions.html)
		return `\
<div class="tool-call-placeholder card bg-base-100 shadow-xl">
	<div class="card-body">
	${args.supported_functions.fount_i18nkeys
				? '<span class="tool-call-placeholder-text" data-i18n="chat.messageView.commonToolCalling"></span>'
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
			display = display.replace(completeRegex, (...replaceArgs) => {
				const groups = replaceArgs.at(-1)
				return completeRenderer(groups.fountToolContent, args, { groups })
			})
			const pendingMatch = new RegExp(
				`(?<fountToolStart>${startPattern})(?<fountToolContent>[\\s\\S]*)$`,
				blockFlags,
			).exec(display)
			if (pendingMatch) {
				const { groups } = pendingMatch
				display = display.slice(0, pendingMatch.index) + pendingRenderer(groups.fountToolContent, args, { groups })
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
			const completeRegex = new RegExp(`(?:${startPattern})([\\s\\S]*?)(?:${endPattern})`, 'g')
			const matches = [...reply.content.matchAll(completeRegex)]

			for (let index = 0; index < matches.length; index++) {
				const matchedContent = matches[index][1]
				if (!(index in cache)) cache[index] = (async () => {
					try { return cache[index] = await exec(matchedContent, args) }
					catch (error) { cache[index] = error }
				})()
			}
			if (matches.length < cache.length) cache.splice(matches.length)

			let matchIndex = 0
			const pendingRenderer = renderPending || ((...pendingArgs) => renderToolCallingPlaceholder(pendingArgs[1]))
			display = display.replace(completeRegex, (_, matchedContent) => {
				const item = cache[matchIndex++]
				if (item instanceof Promise) return pendingRenderer(matchedContent, args)
				if (item instanceof Error) return `[Error: ${item.message}]`
				return String(item)
			})

			const pendingMatch = new RegExp(`(?:${startPattern})([\\s\\S]*)$`).exec(display)
			if (pendingMatch) {
				const rendered = pendingRenderer(pendingMatch[1] ?? '', args)
				display = display.slice(0, pendingMatch.index ?? 0) + rendered
			}
		}

		reply.content_for_show = display
		next?.(args, reply)
	}
}
