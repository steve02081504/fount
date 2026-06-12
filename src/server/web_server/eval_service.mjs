import { async_eval } from 'npm:@steve02081504/async-eval'
import {
	createExpansionScope,
	serializeArgSnapshot,
} from 'npm:@steve02081504/virtual-console/node'
import { handleClientWireMessage } from 'npm:@steve02081504/virtual-console/wire/server'

const WIRE_MAX_DEPTH = 5
const COMPLETION_MAX_ITEMS = 50

/** @type {ReadonlySet<string>} */
const JS_KEYWORDS = new Set([
	'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
	'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
	'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
	'new', 'null', 'of', 'return', 'super', 'switch', 'this', 'throw', 'true',
	'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

/**
 * 将 `async_eval` 结果转为可 JSON 传输的 wire 载荷（与 virtual-console log wire 同形）。
 * @param {{ outputEntries: { toJSON: () => object }[]; result?: unknown; error?: unknown }} evalResult - 求值结果。
 * @param {{ allocRef: (target: object) => string } | null} [expansionScope] - 惰性展开作用域。
 * @returns {object} 含 `outputEntries`、可选 `result` / `error` 快照的对象。
 */
export function serializeEvalWirePayload(evalResult, expansionScope = null) {
	const snapOpts = { maxDepth: WIRE_MAX_DEPTH, expansionScope }
	const payload = {
		outputEntries: evalResult.outputEntries.map(entry => entry.toJSON()),
	}
	if (evalResult.result !== undefined)
		payload.result = serializeArgSnapshot(evalResult.result, snapOpts)
	if (evalResult.error !== undefined)
		payload.error = serializeArgSnapshot(evalResult.error, snapOpts)
	return payload
}

/**
 * 在 `before` 中查找最后一个不在字符串/模板字面量内的 `.`。
 * @param {string} before - 光标前的文本。
 * @returns {number} 下标，无则 -1。
 */
function findLastDotOutsideStrings(before) {
	let inSingle = false
	let inDouble = false
	let inTemplate = false
	let escape = false
	let lastDot = -1
	for (let i = 0; i < before.length; i++) {
		const ch = before[i]
		if (escape) {
			escape = false
			continue
		}
		if (ch === '\\') {
			escape = true
			continue
		}
		if (!inDouble && ch === '\'') {
			inSingle = !inSingle
			continue
		}
		if (!inSingle && ch === '"') {
			inDouble = !inDouble
			continue
		}
		if (!inSingle && !inDouble && ch === '`') {
			inTemplate = !inTemplate
			continue
		}
		if (!inSingle && !inDouble && !inTemplate && ch === '.')
			lastDot = i
	}
	return lastDot
}

/**
 * 解析补全上下文：成员访问或裸标识符。
 * @param {string} code - 完整输入。
 * @param {number} cursor - 光标偏移。
 * @returns {{ kind: 'member', receiver: string, fragment: string, replaceStart: number, replaceEnd: number } | { kind: 'identifier', fragment: string, replaceStart: number, replaceEnd: number } | null} 补全上下文，无法解析时为 `null`。
 */
function parseCompletionContext(code, cursor) {
	const before = code.slice(0, Math.max(0, Math.min(cursor, code.length)))
	const lastDot = findLastDotOutsideStrings(before)
	if (lastDot >= 0) {
		const receiver = before.slice(0, lastDot).trimEnd()
		const fragment = before.slice(lastDot + 1)
		if (!receiver) return null
		return {
			kind: 'member',
			receiver,
			fragment,
			replaceStart: lastDot + 1,
			replaceEnd: cursor,
		}
	}
	const idMatch = before.match(/([\w$]*)$/)
	if (!idMatch) return null
	const fragment = idMatch[1]
	return {
		kind: 'identifier',
		fragment,
		replaceStart: cursor - fragment.length,
		replaceEnd: cursor,
	}
}

/**
 * 沿原型链收集可补全的属性名。
 * @param {unknown} obj - 接收者对象。
 * @param {number} [max] - 最大条数。
 * @returns {string[]} 排序后的属性名。
 */
function collectPropertyNames(obj, max = COMPLETION_MAX_ITEMS) {
	/** @type {Set<string>} */
	const names = new Set()
	/** @type {Set<object>} */
	const seen = new Set()
	let cur = obj
	while (cur && cur !== Object.prototype && typeof cur === 'object' && !seen.has(cur)) {
		seen.add(cur)
		try {
			for (const k of Object.getOwnPropertyNames(cur)) {
				if (k === 'constructor' || k.startsWith('__')) continue
				if (/^[\w$]+$/.test(k)) names.add(k)
			}
		} catch { break }
		try { cur = Object.getPrototypeOf(cur) } catch { break }
	}
	return [...names].sort().slice(0, max)
}

/**
 * 收集 globalThis 与关键字的补全候选。
 * @param {string} fragment - 前缀片段。
 * @returns {string[]} 匹配项。
 */
function collectGlobalCandidates(fragment) {
	/** @type {Set<string>} */
	const names = new Set(JS_KEYWORDS)
	try {
		for (const k of Object.getOwnPropertyNames(globalThis))
			if (/^[\w$]+$/.test(k)) names.add(k)
	} catch { /* ignore */ }
	const lower = fragment.toLowerCase()
	return [...names]
		.filter(n => n.toLowerCase().startsWith(lower))
		.sort()
		.slice(0, COMPLETION_MAX_ITEMS)
}

/**
 * 求值式成员/标识符补全。
 * @param {string} code - 当前输入全文。
 * @param {number} cursor - 光标偏移。
 * @returns {Promise<{ items: string[], replaceStart: number, replaceEnd: number }>} 补全结果。
 */
export async function computeCompletion(code, cursor) {
	const ctx = parseCompletionContext(code, cursor)
	if (!ctx)
		return { items: [], replaceStart: cursor, replaceEnd: cursor }

	if (ctx.kind === 'identifier') {
		const items = collectGlobalCandidates(ctx.fragment)
		return { items, replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd }
	}

	try {
		const evalResult = await async_eval(`return (${ctx.receiver})`)
		if (evalResult.error)
			return { items: [], replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd }
		const names = collectPropertyNames(evalResult.result)
		const lower = ctx.fragment.toLowerCase()
		const items = names
			.filter(n => n.toLowerCase().startsWith(lower))
			.slice(0, COMPLETION_MAX_ITEMS)
		return { items, replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd }
	} catch {
		return { items: [], replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd }
	}
}

/**
 * 在隔离虚拟控制台中异步求值 JavaScript，返回 wire 序列化载荷。
 * @param {string} code - 待求值代码（async-eval 语法）。
 * @param {{ allocRef: (target: object) => string }} expansionScope - 惰性展开作用域。
 * @returns {Promise<object>} wire JSON 载荷。
 */
export async function runEvalCode(code, expansionScope) {
	const evalResult = await async_eval(code)
	return serializeEvalWirePayload(evalResult, expansionScope)
}

/**
 * 回收 eval WebSocket 会话持有的展开引用宿主。
 * @param {object[]} heldEntries - 求值输出 LogEntry 引用列表。
 * @returns {void}
 */
function disposeEvalSession(heldEntries) {
	heldEntries.length = 0
}

/**
 * `/ws/eval` WebSocket 处理器：求值、补全、惰性展开。
 * @param {import('npm:ws').WebSocket} ws - WebSocket 连接。
 * @returns {void}
 */
export function evalServiceWebSocketHandler(ws) {
	/** 会话展开宿主；断链后解除引用以便 GC 回收 expandRegistry。 */
	const sessionHost = {}
	const expansionScope = createExpansionScope(sessionHost)
	/** @type {import('npm:@steve02081504/virtual-console').LogEntry[]} */
	const heldEntries = []

	/**
	 * 发送 JSON 帧。
	 * @param {object} payload - 可序列化对象。
	 * @returns {void}
	 */
	function sendJson(payload) {
		try {
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
		} catch { /* ignore */ }
	}

	ws.on('message', raw => {
		let parsed
		try {
			parsed = JSON.parse(String(raw))
		} catch { return }

		const wireReply = handleClientWireMessage(parsed)
		if (wireReply) {
			sendJson(wireReply)
			return
		}

		const message = /** @type {Record<string, unknown>} */ parsed
		const type = message.type

		if (type === 'eval_request') {
			const id = message.id
			const code = String(message.code ?? '')
			void (async () => {
				try {
					const evalResult = await async_eval(code)
					for (const entry of evalResult.outputEntries)
						heldEntries.push(entry)
					sendJson({
						type: 'eval_result',
						id,
						...serializeEvalWirePayload(evalResult, expansionScope),
					})
				} catch (err) {
					sendJson({
						type: 'eval_result',
						id,
						error: serializeArgSnapshot(err, { maxDepth: WIRE_MAX_DEPTH, expansionScope }),
						outputEntries: [],
					})
				}
			})()
			return
		}

		if (type === 'completion_request') {
			const id = message.id
			const code = String(message.code ?? '')
			const cursor = Number(message.cursor)
			void (async () => {
				try {
					const result = await computeCompletion(code, Number.isFinite(cursor) ? cursor : code.length)
					sendJson({ type: 'completion_result', id, ...result })
				} catch {
					sendJson({
						type: 'completion_result',
						id,
						items: [],
						replaceStart: 0,
						replaceEnd: 0,
					})
				}
			})()
		}
	})

	/**
	 * 连接结束时回收挂起的展开引用。
	 * @returns {void}
	 */
	function onDisconnect() {
		disposeEvalSession(heldEntries)
	}

	ws.on('close', onDisconnect)
	ws.on('error', onDisconnect)
}
