/**
 * 【文件】src/tags/index.mjs
 * 【职责】ReplyHandler 统一标签解析库：解析属性、按标签名收集调用段、解析内层子标签、类型化参数与 body。
 * 【原理】标签名大小写不敏感；属性支持 `k="v"` / `k='v'` / 裸 `k`；完整调用支持 `<t/>`、`<t></t>`、`<t>body</t>`（body 非贪婪）；
 *   收集按出现顺序返回，供管线按「最早出现」逐个消耗，天然防止容器内层标签被单独触发。
 * 【数据结构】call = { tag, occurrence, start, end, raw, inner, attrs, selfClosing }；子标签 = { tag, params, body, raw }。
 * 【关联】被 reply/handlerPipeline.mjs、reply/defineReplyHandler.mjs、streaming/replyPreviews.mjs 使用；替代 file-operations 的 parseTagAttrs 与 MCP 的 parseParams。
 */

/** 单个标签名。 */
const TAG_NAME = '[A-Za-z_][\\w.-]*'
/** 单个属性：`k="v"` / `k='v'` / 裸 `k`。 */
const ATTR = '([A-Za-z_][\\w-]*)(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>/]+)))?'

/**
 * 转义正则特殊字符。
 * @param {string} text 原文
 * @returns {string} 转义后文本
 */
function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 解析标签属性串。
 * @param {string} [attrString] 属性串
 * @returns {Record<string, string | true>} 属性表（裸属性为 true）
 */
export function parseAttrs(attrString) {
	const attrs = {}
	if (!attrString) return attrs
	for (const match of attrString.matchAll(new RegExp(ATTR, 'g')))
		attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? true
	return attrs
}

/**
 * 解析内层子标签（仅顶层，不递归同名嵌套）。
 * @param {string} inner 内层文本
 * @returns {Array<{ tag: string, params: Record<string, string | true>, body: string, raw: string }>} 子标签列表
 */
export function parseChildren(inner) {
	const children = []
	if (!inner) return children
	const regex = new RegExp(`<(${TAG_NAME})([^>]*?)\\s*(?:/>|>([\\s\\S]*?)<\\/\\1\\s*>)`, 'gi')
	for (const match of inner.matchAll(regex))
		children.push({
			tag: match[1],
			params: parseAttrs(match[2]),
			body: match[3] ?? '',
			raw: match[0],
		})
	return children
}

/**
 * 按参数 schema 解析并类型化属性。
 *
 * schema 的每个值为类型名：`'string'`（缺省空串）、`'boolean'`（存在且非 false/0 即真）、`'number'`（缺省 undefined）。
 * 未声明 schema 的属性保持原始字符串。
 * @param {Record<string, string>} [schema] 参数类型表
 * @param {Record<string, string | true>} attrs 已解析属性
 * @returns {Record<string, unknown>} 类型化参数
 */
export function parseParams(schema, attrs) {
	const params = { ...attrs }
	if (!schema) return params
	for (const [key, type] of Object.entries(schema)) {
		const raw = attrs[key]
		if (type === 'boolean')
			params[key] = raw === true || (raw !== undefined && raw !== 'false' && raw !== '0')
		else if (type === 'number')
			params[key] = raw === undefined ? undefined : Number(raw)
		else
			params[key] = raw === undefined ? '' : String(raw)
	}
	return params
}

/**
 * 按 body 声明解析调用体。
 * @param {'text' | 'lines' | 'children' | ((inner: string, call: object) => unknown)} [spec] body 声明
 * @param {string} inner 原始内层文本
 * @param {object} call 调用对象（尚未带 body）
 * @returns {unknown} 解析后的 body
 */
export function parseBody(spec, inner, call) {
	if (typeof spec === 'function') return spec(inner, call)
	if (spec === 'lines') return inner.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
	if (spec === 'children') return parseChildren(inner)
	return inner
}

/**
 * 收集文本中某标签的全部完整调用（按出现顺序）。
 * @param {string} content 待解析文本
 * @param {string} tag 标签名
 * @returns {Array<{ tag: string, occurrence: number, start: number, end: number, raw: string, inner: string, attrs: Record<string, string | true>, selfClosing: boolean }>} 调用列表
 */
export function collectTagCalls(content, tag) {
	const name = escapeRegExp(tag)
	const regex = new RegExp(`<${name}([^>]*?)\\s*(?:/>|>([\\s\\S]*?)<\\/${name}\\s*>)`, 'gi')
	const calls = []
	let occurrence = 0
	for (const match of content.matchAll(regex)) {
		const raw = match[0]
		calls.push({
			tag,
			occurrence: occurrence++,
			start: match.index,
			end: match.index + raw.length,
			raw,
			inner: match[2] ?? '',
			attrs: parseAttrs(match[1]),
			selfClosing: /\/>\s*$/.test(raw),
		})
	}
	return calls
}

/**
 * 将文本中某标签的全部完整调用段替换为空白，便于定位未闭合的尾标签。
 * @param {string} content 待解析文本
 * @param {string} tag 标签名
 * @returns {string} 抹除完整调用后的文本（长度不变）
 */
function eraseCompleteCalls(content, tag) {
	const name = escapeRegExp(tag)
	return content.replace(
		new RegExp(`<${name}([^>]*?)\\s*(?:/>|>[\\s\\S]*?<\\/${name}\\s*>)`, 'gi'),
		match => ' '.repeat(match.length),
	)
}

/**
 * 找出文本中未闭合的尾标签（流式预览用）。
 * @param {string} content 待解析文本
 * @param {string} tag 标签名
 * @returns {{ tag: string, occurrence: number, start: number, end: number, raw: string, inner: string, attrs: Record<string, string | true>, open: true } | null} 未闭合调用
 */
export function findOpenTag(content, tag) {
	const name = escapeRegExp(tag)
	const erased = eraseCompleteCalls(content, tag)
	const match = new RegExp(`<${name}([^>]*?)\\s*>`, 'i').exec(erased)
	if (!match) return null
	return {
		tag,
		occurrence: collectTagCalls(content, tag).length,
		start: match.index,
		end: content.length,
		raw: content.slice(match.index),
		inner: content.slice(match.index + match[0].length),
		attrs: parseAttrs(match[1]),
		open: true,
	}
}

/**
 * 将 `{ start, end }` 起止声明编译为带 `g` 标志的完整调用正则。
 * @param {{ start: string | RegExp, end: string | RegExp }} pattern 起止声明
 * @returns {RegExp} 完整调用正则
 */
function compileRangePattern(pattern) {
	const startPattern = pattern.start instanceof RegExp ? pattern.start.source : escapeRegExp(pattern.start)
	const endPattern = pattern.end instanceof RegExp ? pattern.end.source : escapeRegExp(pattern.end)
	let flags = 'g'
	for (const spec of [pattern.start, pattern.end])
		if (spec instanceof RegExp) flags += spec.flags
	flags = [...new Set(flags.split(''))].join('').replace('y', '')
	return new RegExp(`(?:${startPattern})[\\s\\S]*?(?:${endPattern})`, flags)
}

/**
 * 解析任意 pattern 声明，收集完整调用（非 `{tag}` 逃生口用）。
 *
 * 返回元素统一带 `raw`/`start`/`end`/`inner`；`RegExp` 与 `{start,end}` 另带 `match`/`groups`。
 * @param {string} content 待解析文本
 * @param {RegExp | { start: string | RegExp, end: string | RegExp } | ((content: string, args: object) => object[])} pattern 模式声明
 * @param {object} [args] 请求上下文（函数式 pattern 用）
 * @returns {object[]} 调用列表
 */
export function collectPatternCalls(content, pattern, args) {
	if (typeof pattern === 'function')
		return pattern(content, args) ?? []
	if (pattern instanceof RegExp) {
		const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
		const regex = new RegExp(pattern.source, flags)
		return [...content.matchAll(regex)].map(match => ({
			raw: match[0],
			start: match.index,
			end: match.index + match[0].length,
			inner: match.groups?.content ?? match.groups?.code ?? match[1] ?? '',
			match,
			groups: match.groups,
		}))
	}
	const regex = compileRangePattern(pattern)
	return [...content.matchAll(regex)].map(match => ({
		raw: match[0],
		start: match.index,
		end: match.index + match[0].length,
		inner: match[0],
		match,
	}))
}
