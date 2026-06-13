import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/main.mjs'
import {
	createExpansionScope,
	serializeArgSnapshot,
} from 'npm:@steve02081504/virtual-console/node'
import { handleClientWireMessage } from 'npm:@steve02081504/virtual-console/wire/server'

import {
	JS_KEYWORDS,
	enrichCompletionWirePayload,
	filterByCompletionPrefix,
	parseCompletionContext,
} from './completion.mjs'

const WIRE_MAX_DEPTH = 5
const COMPLETION_MAX_ITEMS = 50

/**
 * 将 `async_eval` 结果转为可 JSON 传输的 wire 载荷（与 virtual-console log wire 同形）。
 * @param {{ outputEntries: { toJSON: () => object }[]; result?: unknown; error?: unknown }} evalResult - 求值结果。
 * @param {{ allocRef: (target: object) => string } | null} [expansionScope] - 惰性展开作用域。
 * @returns {object} 含 `outputEntries`、成功时必有 `result` 快照、失败时 `error` 快照的对象。
 */
export function serializeEvalWirePayload(evalResult, expansionScope = null) {
	const snapOpts = { maxDepth: WIRE_MAX_DEPTH, expansionScope }
	const payload = {
		outputEntries: evalResult.outputEntries.map(entry => entry.toJSON()),
	}
	if (evalResult.error !== undefined)
		payload.error = serializeArgSnapshot(evalResult.error, snapOpts)
	else
		payload.result = serializeArgSnapshot(evalResult.result, snapOpts)
	return payload
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
	let current = obj
	while (current && current !== Object.prototype && typeof current === 'object' && !seen.has(current)) {
		seen.add(current)
		try {
			for (const propertyName of Object.getOwnPropertyNames(current)) {
				if (propertyName === 'constructor' || propertyName.startsWith('__')) continue
				if (/^[\w$]+$/.test(propertyName)) names.add(propertyName)
			}
		} catch { break }
		try { current = Object.getPrototypeOf(current) } catch { break }
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
		for (const propertyName of Object.getOwnPropertyNames(globalThis))
			if (/^[\w$]+$/.test(propertyName)) names.add(propertyName)
	} catch { /* ignore */ }
	return filterByCompletionPrefix(fragment, names)
		.sort()
		.slice(0, COMPLETION_MAX_ITEMS)
}

/**
 * 求值式成员/标识符补全。
 * @param {string} code - 当前输入全文。
 * @param {number} cursor - 光标偏移。
 * @returns {Promise<{ items: string[], replaceStart: number, replaceEnd: number, suffixes: string[] }>} 补全结果。
 */
export async function computeCompletion(code, cursor) {
	const ctx = parseCompletionContext(code, cursor)
	if (!ctx)
		return enrichCompletionWirePayload(code, { items: [], replaceStart: cursor, replaceEnd: cursor })

	if (ctx.kind === 'identifier') {
		const items = collectGlobalCandidates(ctx.fragment)
		return enrichCompletionWirePayload(code, {
			items, replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd,
		})
	}

	try {
		const evalResult = await async_eval(`return (${ctx.receiver})`)
		if (evalResult.error)
			return enrichCompletionWirePayload(code, {
				items: [], replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd,
			})
		const names = collectPropertyNames(evalResult.result)
		const items = filterByCompletionPrefix(ctx.fragment, names)
			.slice(0, COMPLETION_MAX_ITEMS)
		return enrichCompletionWirePayload(code, {
			items, replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd,
		})
	} catch {
		return enrichCompletionWirePayload(code, {
			items: [], replaceStart: ctx.replaceStart, replaceEnd: ctx.replaceEnd,
		})
	}
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
						suffixes: [],
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
