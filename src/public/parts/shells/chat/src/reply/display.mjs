/**
 * 【文件】src/reply/display.mjs
 * 【职责】ReplyHandler 的展示层渲染：默认 display、本地化占位、块级替换的行边界补全。
 * 【原理】display(call, state, args) 由工具自定义；缺省时按 state 推导——已求值显示 value、出错显示 error、
 *   无 evaluate 时 streaming 显示占位 / final 折叠为空。块级替换结果（围栏代码块 / 块级 HTML）前后补空行，避免拼接进段落。
 * 【数据结构】state = { stage: 'streaming' | 'final', open: boolean, value?: unknown, error?: Error }。
 * 【关联】被 streaming/replyPreviews.mjs 与 reply/handlerPipeline.mjs 共用；依赖 streaming/markdown.mjs 的 getChatI18n。
 */
import { getChatI18n } from '../streaming/markdown.mjs'

/**
 * 渲染「正在调用工具」的本地化占位。
 * @param {object} args 请求上下文
 * @returns {string} 占位文本（HTML / Markdown / 纯文本）
 */
export function renderToolCallingPlaceholder(args) {
	/**
	 * 获取本地化「正在调用工具」文案。
	 * @returns {string} 本地化文案
	 */
	const toolCallingText = () => getChatI18n(args, 'chat.message.view.commonToolCalling')
	if (args.supported_functions?.html)
		return `\
<div class="tool-call-placeholder card my-2 bg-base-100 text-sm shadow-xl">
	<div class="card-body">
	${args.supported_functions.fount_i18nkeys
		? '<span class="tool-call-placeholder-text" data-i18n="chat.message.view.commonToolCalling"></span>'
		: `<span class="tool-call-placeholder-text">${toolCallingText()}</span>`}
	</div>
</div>
`
	if (args.supported_functions?.markdown) return `*[[${toolCallingText()}]]*`
	return `(${toolCallingText()})`
}

/**
 * 缺省 display：按 state 推导展示文本。
 * @param {object} call 调用对象
 * @param {{ stage: string, open: boolean, value?: unknown, error?: Error }} state 展示状态
 * @param {object} args 请求上下文
 * @returns {string} 展示文本
 */
export function defaultDisplay(call, state, args) {
	if (state.error) return `[Error: ${state.error.message ?? state.error}]`
	if (state.value !== undefined && state.value !== null) return String(state.value)
	return state.stage === 'streaming' ? renderToolCallingPlaceholder(args) : ''
}

/**
 * 调用工具声明的 display（缺省回退 defaultDisplay）。
 * @param {object} handler 规范化的 ReplyHandler
 * @param {object} call 调用对象
 * @param {{ stage: string, open: boolean, value?: unknown, error?: Error }} state 展示状态
 * @param {object} args 请求上下文
 * @returns {string} 展示文本
 */
export function renderCallDisplay(handler, call, state, args) {
	if (handler.display) return handler.display(call, state, args)
	return defaultDisplay(call, state, args)
}

/**
 * 判定渲染结果是否为块级内容（围栏代码块，或以块级 HTML 标签开头）。
 * @param {string} rendered 渲染结果
 * @returns {boolean} 是否块级
 */
export function isBlockLevelRendered(rendered) {
	if (/```|~~~/.test(rendered)) return true
	return /^[ \t\r\n]*<(?:div|figure|details|blockquote|pre|table|ul|ol|h[1-6])[\s>]/i.test(rendered)
}

/**
 * 按需在替换点前后补空行，保证块级渲染结果落在行边界上。
 * @param {string} display 原文
 * @param {number} index 匹配起点
 * @param {number} end 匹配终点
 * @param {string} rendered 渲染结果
 * @returns {string} 带行边界补全的替换文本
 */
export function padBlockRendered(display, index, end, rendered) {
	if (!isBlockLevelRendered(rendered)) return rendered
	let padded = rendered
	if (index > 0 && display[index - 1] !== '\n') padded = `\n\n${padded}`
	if (end < display.length && display[end] !== '\n') padded += '\n\n'
	return padded
}
