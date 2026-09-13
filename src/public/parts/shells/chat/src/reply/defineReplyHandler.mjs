/**
 * 【文件】src/reply/defineReplyHandler.mjs
 * 【职责】ReplyHandler 作者助手：把可读声明（tag/params/body/phase）规范化为管线唯一认识的底层对象；并提供组合与展开。
 * 【原理】有 tag 时生成 `pattern = { tag, params, body }`；phase 是可读糖，before/action/after 分别折算 -100/0/+100，
 *   再与显式 level 相加得到最终 level（底层只保留 level）。无 tag/pattern 即内容型 handler（整条 content、无 display）。
 *   多个 handler 经 `defineReplyHandlers` 封装为单个组合节点 `{ handlers }`，管线/预览用 `flattenReplyHandlers` 展开。
 *   `parallel` 声明与其他 handler 的并行兼容性（`true`=与所有启用并行者兼容；字符串数组=只与列出的 handler 名兼容）。
 *   声明 `evaluate` 者视为 inline 类（会产生可展示值）；管线据此自动追加处理后回执，无需额外开关字段。
 * 【数据结构】叶子 handler = { name, pattern?, level, evaluate?, display?, parallel?, handle }；组合节点 = { handlers: ReplyHandler_t[] }。
 * 【关联】被各插件/角色与 reply/handlerPipeline.mjs、streaming/replyPreviews.mjs 使用；标签解析见 tags/index.mjs。
 */

/** phase 可读糖 → 基础 level 偏移。 */
const PHASE_LEVEL = { before: -100, action: 0, after: 100 }

/**
 * 定义并规范化一个 ReplyHandler。
 *
 * 声明的 `phase` 与 `level` 共同作用（相加）得到最终 level，而非互相覆盖。
 * @param {object} declaration 声明
 * @param {string} [declaration.tag] 标签名（配合统一解析库）
 * @param {object | RegExp | { start: string | RegExp, end: string | RegExp } | Function} [declaration.pattern] 逃生口模式（优先于 tag）
 * @param {Record<string, string>} [declaration.params] 属性类型表
 * @param {'text' | 'lines' | 'children' | Function} [declaration.body] body 解析方式
 * @param {'before' | 'action' | 'after'} [declaration.phase] 可读执行阶段（默认 action）
 * @param {number} [declaration.level] 精细 level 偏移（与 phase 相加）
 * @param {string} [declaration.name] 可读标识（默认取 tag）
 * @param {(call: object, args: object) => Promise<unknown>} [declaration.evaluate] 提前求值（流式期缓存）
 * @param {(call: object, state: object, args: object) => string} [declaration.display] 展示层渲染
 * @param {boolean | string[]} [declaration.parallel] 并行兼容性（true=与所有启用并行者兼容；字符串数组=只与列出的 handler 名兼容）
 * @param {(reply: object, args: object, call: object | null) => Promise<object>} declaration.handle 处理器
 * @returns {object} 规范化的 ReplyHandler
 */
export function defineReplyHandler(declaration) {
	const {
		tag, pattern, params, body = 'text', phase = 'action', level = 0,
		name = tag, evaluate, display, parallel, handle,
	} = declaration
	if (typeof handle !== 'function')
		throw new TypeError('defineReplyHandler 需要 handle 函数')
	const finalLevel = (PHASE_LEVEL[phase] ?? 0) + level
	if (!pattern && !tag)
		return { name: name ?? 'content', level: finalLevel, handle }
	const resolvedPattern = pattern ?? { tag, params, body }
	const resolvedName = name ?? (resolvedPattern instanceof RegExp ? undefined : resolvedPattern.tag)
	if (!resolvedName)
		throw new TypeError('defineReplyHandler 的非标签 pattern 需要显式 name')
	return {
		name: resolvedName,
		pattern: resolvedPattern,
		level: finalLevel,
		evaluate,
		display,
		parallel,
		handle,
	}
}

/**
 * 把一组 ReplyHandler 组合为单个 ReplyHandler（组合节点，自身不执行）。
 *
 * 插件/角色的 `ReplyHandler` 字段始终是单个 `ReplyHandler_t`；需要多个标签/阶段时用它打包。
 * @param {import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t[]} handlers 子 handler 列表
 * @returns {import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t} 组合节点
 */
export function defineReplyHandlers(handlers) {
	return { handlers: (Array.isArray(handlers) ? handlers : [handlers]).filter(Boolean) }
}

/**
 * 展开组合节点为叶子 handler 列表（递归）；同时接受单个 handler 或 handler 数组。
 * @param {import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t | import('../../../../../../decl/pluginAPI.ts').ReplyHandler_t[]} handlers handler 或列表
 * @param {object[]} [out] 累积输出
 * @returns {object[]} 叶子 handler 列表
 */
export function flattenReplyHandlers(handlers, out = []) {
	const list = Array.isArray(handlers) ? handlers : [handlers]
	for (const handler of list) {
		if (!handler) continue
		if (handler.handlers) flattenReplyHandlers(handler.handlers, out)
		else out.push(handler)
	}
	return out
}
