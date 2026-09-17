import { async_eval } from 'npm:@steve02081504/async-eval'
import {
	createExpansionScope,
	expandSnapshotRef,
	serializeArgSnapshot,
	VirtualConsole,
	WireLogEntry,
} from 'npm:@steve02081504/virtual-console/node'
import { handleClientWireMessage } from 'npm:@steve02081504/virtual-console/wire/server'

import { config } from '../../../server.mjs'

import {
	JS_KEYWORDS,
	enrichCompletionWirePayload,
	filterByCompletionPrefix,
	parseCompletionContext,
} from './completion.mjs'

const WIRE_MAX_DEPTH = 5
const COMPLETION_MAX_ITEMS = 50

/** 文本模式渲染的最大快照深度（与旧 CLI 客户端 `renderString({ maxDepth: 8 })` 对齐）。 */
const TEXT_RENDER_MAX_DEPTH = 8

/**
 * 本地展开被截断的快照（服务端文本渲染用，无需经由 WebSocket 往返）。
 * @param {string} ref - 展开引用。
 * @param {number} [depth] - 期望深度。
 * @returns {Promise<unknown>} 展开后的快照。
 */
async function localExpandSnapshot(ref, depth) {
	const result = expandSnapshotRef(ref, depth)
	if (!result.ok) throw new Error(result.error)
	return result.snapshot
}

/**
 * 将一条 wire 载荷渲染为终端文本（ANSI 或纯文本）。
 * 原样返回、不裁剪不补换行：`console.log` 自带结尾换行，`stdout.write` 没有就保持没有。
 * @param {object} raw - wire 载荷（`LogEntry#toJSON()` 同形）。
 * @param {{ ansi?: boolean, maxDepth?: number }} [options] - 渲染选项。
 * @returns {Promise<string>} 渲染文本（逐字）
 */
async function renderWireEntryText(raw, { ansi = false, maxDepth = TEXT_RENDER_MAX_DEPTH } = {}) {
	const entry = new WireLogEntry(raw, {
		requestExpand: localExpandSnapshot,
		supportsAnsi: ansi,
	})
	return ansi
		? entry.renderString({ indent: '  ', maxDepth })
		: entry.renderPlain({ indent: '  ', maxDepth })
}

/**
 * 将求值完成值/错误渲染为文本行（文本模式客户端用）。
 * @param {{ result?: unknown; error?: unknown }} evalResult - 求值结果。
 * @param {{ ansi?: boolean, expansionScope?: object | null }} [options] - 渲染选项。
 * @returns {Promise<string>} 渲染后的文本。
 */
async function renderEvalOutcomeText(evalResult, { ansi = false, expansionScope = null } = {}) {
	const isError = evalResult.error !== undefined
	const snapshot = serializeArgSnapshot(isError ? evalResult.error : evalResult.result, {
		maxDepth: TEXT_RENDER_MAX_DEPTH,
		expansionScope,
	})
	return renderWireEntryText({
		method: isError ? 'error' : 'result',
		level: isError ? 'error' : 'log',
		timestamp: Date.now(),
		segments: [{ kind: 'value', snapshot }],
	}, { ansi, maxDepth: TEXT_RENDER_MAX_DEPTH })
}

/**
 * 将求值完成值/错误序列化为 wire 快照（结构化客户端用；已流式的输出条目不再重复）。
 * @param {{ result?: unknown; error?: unknown }} evalResult - 求值结果。
 * @param {{ allocRef: (target: object) => string } | null} [expansionScope] - 惰性展开作用域。
 * @returns {{ result?: unknown } | { error?: unknown }} 完成载荷。
 */
export function serializeEvalOutcome(evalResult, expansionScope = null) {
	const snapOpts = { maxDepth: WIRE_MAX_DEPTH, expansionScope }
	if (evalResult.error !== undefined)
		return { error: serializeArgSnapshot(evalResult.error, snapOpts) }
	return { result: serializeArgSnapshot(evalResult.result, snapOpts) }
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
		const evalResult = await async_eval(`(${ctx.receiver})`, {
			config
		})
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
		const { type } = message

		if (type === 'eval_request') {
			const { id } = message
			const code = String(message.code ?? '')
			const textMode = message.text === true
			const ansi = message.ansi === true
			void (async () => {
				// 每条 console 条目即时推送：结构化客户端自行渲染，文本模式由服务端渲染好文本。
				const evalConsole = new VirtualConsole({ realConsoleOutput: true })
				let textRenderQueue = Promise.resolve()
				/**
				 * @param {import('npm:@steve02081504/virtual-console').LogEntry} entry - 新日志条目。
				 * @returns {void}
				 */
				const onEntry = entry => {
					heldEntries.push(entry)
					const raw = entry.toJSON()
					if (!textMode) {
						sendJson({ type: 'eval_output', id, entry: raw })
						return
					}
					textRenderQueue = textRenderQueue
						.then(async () => sendJson({ type: 'eval_output', id, text: await renderWireEntryText(raw, { ansi }) }))
						.catch(() => { })
				}
				evalConsole.addLogEntryListener(onEntry)
				try {
					const evalResult = await async_eval(code, { config, console: evalConsole })
					await textRenderQueue
					if (textMode)
						sendJson({
							type: 'eval_result',
							id,
							error: evalResult.error !== undefined,
							text: await renderEvalOutcomeText(evalResult, { ansi, expansionScope }),
						})
					else
						sendJson({ type: 'eval_result', id, ...serializeEvalOutcome(evalResult, expansionScope) })
				} catch (err) {
					await textRenderQueue
					if (textMode)
						sendJson({
							type: 'eval_result',
							id,
							error: true,
							text: await renderEvalOutcomeText({ error: err }, { ansi, expansionScope }),
						})
					else
						sendJson({
							type: 'eval_result',
							id,
							error: serializeArgSnapshot(err, { maxDepth: WIRE_MAX_DEPTH, expansionScope }),
						})
				}
			})()
			return
		}

		if (type === 'completion_request') {
			const { id } = message
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
