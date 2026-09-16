/**
 * `fount eval`：把一段 JS 发送到运行中的 fount 服务器（`/ws/eval`）求值并打印结果。
 * 便于人类与 agent 在实例内检查运行态、复现/调试问题。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { connectLogWire, WireLogEntry } from 'npm:@steve02081504/virtual-console/wire/client'

const FOUNT_DIR = path.resolve(import.meta.dirname + '/../../')
const DEFAULT_PORT = 8931

/**
 * 从 `data/config.json` 读取服务器端口，失败时回落到默认值。
 * @returns {number} 端口号
 */
function readPort() {
	try {
		const config = JSON.parse(fs.readFileSync(path.join(FOUNT_DIR, 'data/config.json'), 'utf-8'))
		if (Number.isFinite(config?.port)) return config.port
	}
	catch { /* 使用默认端口 */ }
	return DEFAULT_PORT
}

/**
 * 读取 stdin 全部内容。
 * @returns {Promise<string>} 文本
 */
async function readStdin() {
	let text = ''
	for await (const chunk of process.stdin)
		text += chunk
	return text
}

const args = process.argv.slice(2)
let port = readPort()
/** @type {string | undefined} 从文件读取的代码路径。 */
let codeFile
const codeParts = []
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--port' && args[i + 1]) { port = Number(args[++i]); continue }
	if (args[i].startsWith('--port=')) { port = Number(args[i].slice('--port='.length)); continue }
	if ((args[i] === '-f' || args[i] === '--file') && args[i + 1]) { codeFile = args[++i]; continue }
	codeParts.push(args[i])
}
let code = codeFile ? fs.readFileSync(codeFile, 'utf-8').trim() : codeParts.join(' ').trim()
if (!code && !process.stdin.isTTY)
	code = (await readStdin()).trim()
if (!code) {
	console.error('usage: fount eval <code> | fount eval -f <file>   (或通过 stdin 管道传入代码)')
	process.exit(1)
}

const url = `ws://localhost:${port}/ws/eval`

const { conn, payload } = await new Promise((resolve, reject) => {
	let settled = false
	/**
	 * 只结算一次。
	 * @param {Function} fn resolve 或 reject
	 * @param {unknown} value 值
	 * @returns {void}
	 */
	const done = (fn, value) => { if (!settled) { settled = true; fn(value) } }

	let evalConn
	try {
		evalConn = connectLogWire(url, {
			extensionHandlers: {
				/**
				 * 收到求值结果，结算外围 Promise。
				 * @param {object} result `eval_result` 载荷
				 * @returns {void}
				 */
				eval_result: result => done(resolve, { conn: evalConn, payload: result }),
			},
			/**
			 * 连接关闭时若尚未结算则以错误结算。
			 * @returns {void}
			 */
			onClose: () => done(reject, new Error(`连接已关闭（fount 服务器在 ${port} 端口运行吗？）`)),
			/**
			 * 致命错误时若尚未结算则拒绝。
			 * @param {unknown} err 错误
			 * @returns {void}
			 */
			onFatal: err => done(reject, err instanceof Error ? err : new Error(String(err))),
		})
	}
	catch (err) {
		done(reject, err)
		return
	}

	/**
	 * 连接就绪后发送求值请求。
	 * @returns {void}
	 */
	const send = () => {
		try { evalConn.sendJson({ type: 'eval_request', id: 'fount-eval', code }) }
		catch (err) { done(reject, err) }
	}

	const { ws } = evalConn
	if (ws.readyState === WebSocket.OPEN) send()
	else {
		ws.addEventListener('open', send, { once: true })
		ws.addEventListener('error', () => done(reject, new Error(`无法连接 ${url}`)), { once: true })
		ws.addEventListener('close', () => done(reject, new Error(`无法连接 ${url}`)), { once: true })
	}
})

const wireContext = {
	/**
	 * 请求展开被截断的快照。
	 * @param {string} ref 展开引用 ID
	 * @param {number} maxDepth 最大深度
	 * @returns {Promise<unknown>} 展开后的快照
	 */
	requestExpand: (ref, maxDepth) => conn.requestExpand(ref, maxDepth),
	supportsAnsi: Boolean(process.stdout.isTTY),
}
const lines = []
/**
 * 将 wire 快照渲染为文本行。
 * @param {object} entry wire 日志条目
 * @returns {Promise<string>} 渲染后的文本
 */
const render = async entry => (await new WireLogEntry(entry, wireContext).renderString({ indent: '  ', maxDepth: 8 })).replace(/\n+$/, '')
for (const entry of payload.outputEntries ?? [])
	lines.push(await render(entry))

const snapshot = payload.error !== undefined
	? { method: 'error', level: 'error', snapshot: payload.error }
	: 'result' in payload ? { method: 'result', level: 'log', snapshot: payload.result } : null
if (snapshot)
	lines.push(await render({
		method: snapshot.method,
		level: snapshot.level,
		timestamp: Date.now(),
		segments: [{ kind: 'value', snapshot: snapshot.snapshot }],
	}))

process.stdout.write(lines.join('\n') + '\n')
try { conn.detach?.() } catch { /* ignore */ }
try { conn.ws?.close() } catch { /* ignore */ }
process.exit(payload.error !== undefined ? 1 : 0)
