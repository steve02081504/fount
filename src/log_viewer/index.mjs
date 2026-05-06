/**
 * 独立日志查看器：连接本地 fount 服务器的 `/ws/logs` 中央端点，把实时日志流写入当前终端。
 *
 * 设计目标：
 * - 作为后台服务器进程的“前台脸面”，始终能在交互终端中显示主进程输出。
 * - 服务器未就绪时持续轮询 `/api/ping`（指数退避，无超时），网络/进程恢复后自动接续。
 * - 服务器主动退出（`fount_exit`）时与服务器同步：`code === 131` 视为重启，自动重连；其它退出码本进程同码退出。
 * - WebSocket 异常断开（无 `fount_exit`）按指数退避重连，等服务器再次起来。
 *
 * 直接执行：`deno run -c deno.json --allow-net=127.0.0.1 src/log_viewer/index.mjs`
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { connectLogWire } from 'npm:@steve02081504/virtual-console/wire/client'
import supportsAnsi from 'npm:supports-ansi'

import { printTerminalImage } from '../scripts/logo.mjs'
import { SetTaskbarProgress, ClearTaskbarProgress } from '../scripts/taskbar_progress.mjs'
import { setWindowTitle } from '../scripts/title.mjs'
import { runSimpleWorker } from '../workers/index.mjs'

setWindowTitle('𝓯𝓸𝓾')
SetTaskbarProgress(50)

const FOUNT_DIR = path.resolve(import.meta.dirname + '/../../')

/**
 * 从 `data/config.json` 读取服务器端口；读取/解析失败时回落到默认 8931。
 * @returns {number} 监听端口。
 */
function readServerPort() {
	try {
		const raw = fs.readFileSync(path.join(FOUNT_DIR, 'data/config.json'), 'utf-8')
		const cfg = JSON.parse(raw)
		if (Number.isFinite(cfg?.port)) return cfg.port
	} catch { /* 配置缺失或损坏：使用默认端口 */ }
	return 8931
}

const PORT = readServerPort()
const PING_URL = `http://127.0.0.1:${PORT}/api/ping`
const WS_URL = `ws://127.0.0.1:${PORT}/ws/logs`

const ANSI_RESET = '\x1b[0m'
const LEVEL_PREFIX_COLORS = {
	error: '\x1b[31m',
	warn: '\x1b[33m',
	info: '\x1b[36m',
	debug: '\x1b[2m',
}

/**
 * 顶层错误兜底（供异步日志写入复用）。
 * @param {Error} err - 未捕获的致命错误。
 * @returns {void}
 */
function onFatal(err) {
	process.stderr.write(`log_viewer fatal: ${err?.stack ?? err}\n`)
	process.exit(1)
}

/**
 * 异步阻塞指定毫秒数。
 * @param {number} milliseconds - 阻塞时长。
 * @returns {Promise<void>} 时间到后兑现。
 */
function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * 写入一条已渲染的日志（`await entry.renderString()`，与进程内 {@link LogEntry#toString} 同源 ANSI 管线；勿用 `toString()`，{@link WireLogEntry} 未覆写会落到 `[object Object]`）。
 * @param {import('npm:@steve02081504/virtual-console/wire/client').WireLogEntry} entry - `connectLogWire` 下发的异步条目。
 * @returns {Promise<void>}
 */
async function writeEntry(entry) {
	const body = await entry.renderString({ indent: '  ', maxDepth: 5 })
	const color = LEVEL_PREFIX_COLORS[entry?.level]
	const text = color ? `${color}${body}${ANSI_RESET}` : body
	process.stdout.write(text)
}

let stopRequested = false
/** @type {ReturnType<typeof connectLogWire> | null} */
let connection = null

/**
 * 阻塞至 `/api/ping` 返回 200 为止；指数退避（200ms → 5000ms 上限），用户 Ctrl+C 则结束。
 * @returns {Promise<void>} 服务器就绪或停止时兑现。
 */
async function pollUntilServerReady() {
	let delay = 200
	while (!stopRequested) try {
		const res = await fetch(PING_URL, { signal: AbortSignal.timeout(2000) })
		if (res.ok) return
	} catch {
		await sleep(delay)
		delay = Math.min(delay * 2, 5000)
	}
}

/**
 * 处理快照消息：清屏后逐条打印缓冲中的历史日志。
 * @param {import('npm:@steve02081504/virtual-console/wire/client').WireLogEntry[]} entries - 快照条目列表。
 * @returns {Promise<void>}
 */
async function handleSnapshot(entries) {
	for (const entry of entries)
		await writeEntry(entry)
}

/**
 * 处理追加消息：直接打印新进来的单条。
 * @param {import('npm:@steve02081504/virtual-console/wire/client').WireLogEntry} entry - 线路条目。
 * @returns {Promise<void>}
 */
async function handleAppend(entry) {
	await writeEntry(entry)
}

/**
 * 处理服务器侧 clear 广播：清空终端屏幕。
 * @returns {Promise<void>}
 */
async function handleClear() {
	if (supportsAnsi) process.stdout.write('\x1Bc')
	console.clear()
	await printTerminalImage().catch(_ => 0)
	connection.sendJson({ type: 'rand_tip' })
	return
}

/**
 * 建立一次 WebSocket 连接并等待其结束（断连或 `fount_exit`）。
 * 返回结束原因；若是 `fount_exit`，将退出码写入闭包外的 `pendingExitCode`。
 * @param {{ setExitCode: (code: number) => void }} ctx - 用于回传 `fount_exit` 的退出码。
 * @returns {Promise<'fount_exit' | 'close'>} 解析为本次连接的终止原因。
 */
function runOneConnection(ctx) {
	/**
	 * Promise 执行器，作为本次连接的状态机。
	 * @param {(reason: 'fount_exit' | 'close') => void} resolve - 兑现器。
	 * @returns {void}
	 */
	const executor = (resolve) => {
		let settled = false
		/**
		 * 收尾本次连接：解绑事件、关闭 socket、兑现外层 Promise（幂等）。
		 * @param {'fount_exit' | 'close'} reason - 终止原因。
		 * @returns {void}
		 */
		const finish = (reason) => {
			if (settled) return
			settled = true
			try { connection?.detach?.() } catch { /* 忽略二次解绑 */ }
			try { connection?.close?.() } catch { /* 忽略已关闭 */ }
			connection = null
			resolve(reason)
		}

		/**
		 * 宿主扩展帧：`fount_exit`。
		 * @param {{ type?: string, code?: number }} raw - 原始 JSON 对象。
		 * @returns {void}
		 */
		const handleFountExit = (raw) => {
			ctx.setExitCode(Number.isFinite(raw?.code) ? raw.code : 0)
			finish('fount_exit')
		}

		/**
		 * 处理服务器打开事件：设置窗口标题和任务栏进度。
		 * @returns {void}
		 */
		const handleOpen = () => {
			setWindowTitle('𝓯𝓸𝓾𝓷𝓽')
			ClearTaskbarProgress()
		}

		/**
		 * WebSocket close 事件：统一收尾为 'close'（若已是 fount_exit 则被幂等忽略）。
		 * @returns {void}
		 */
		const handleClose = () => finish('close')

		/**
		 * WebSocket error 事件：让 onClose 统一收尾，不在此处处理。
		 * @returns {void}
		 */
		const handleError = () => { /* noop */ }

		/**
		 * 处理输出事件：直接打印新进来的单条。
		 * @param {object} raw - 原始 JSON 对象。
		 * @param {string} raw.text - 输出文本。
		 * @returns {Promise<void>}
		 */
		const handleOutput = (raw) => {
			process.stdout.write(raw.text)
		}

		/**
		 * 处理初始信息事件：打印初始信息。
		 * logo text需要根据窗口宽度变化所以必须通过本线程生成
		 * @param {object} raw - 原始 JSON 对象。
		 * @param {string} raw.text - 初始信息文本。
		 * @returns {Promise<void>}
		 */
		const handleShowInitialInfo = async (raw) => {
			console.log(await runSimpleWorker('logogener'))
			process.stdout.write(raw.text)
		}

		try {
			connection = connectLogWire(WS_URL, {
				onSnapshot: handleSnapshot,
				onAppend: handleAppend,
				onClear: handleClear,
				extensionHandlers: {
					show_initial_info: handleShowInitialInfo,
					output: handleOutput,
					fount_exit: handleFountExit
				},
				onOpen: handleOpen,
				onClose: handleClose,
				onError: handleError,
				onParseError: onFatal,
			})
		} catch {
			finish('close')
		}
	}

	return new Promise(executor)
}

/**
 * 进入运行循环：等待服务器就绪 → 建立连接 → 处理终止原因（重连/退出/退避）。
 * @returns {Promise<void>} 仅在 `process.exit` 被调用时实际终止。
 */
async function main() {
	const exitCodeSlot = { value: /** @type {number | null} */ null }
	/**
	 * 由 `runOneConnection` 用于回传 `fount_exit` 携带的退出码。
	 * @param {number} code - 服务器报告的退出码。
	 * @returns {void}
	 */
	const setExitCode = (code) => { exitCodeSlot.value = code }
	const ctx = { setExitCode }

	/**
	 * SIGINT 处理：标记停止，关闭当前连接，立即以 130 退出。
	 * @returns {void}
	 */
	const onSigint = () => {
		stopRequested = true
		try { connection?.close?.() } catch { /* ignore */ }
		process.exit(130)
	}
	process.on('SIGINT', onSigint)

	let backoff = 500
	while (!stopRequested) {
		await pollUntilServerReady()
		if (stopRequested) break
		const reason = await runOneConnection(ctx)

		if (reason === 'fount_exit') {
			const code = exitCodeSlot.value ?? 0
			exitCodeSlot.value = null
			if (code === 131) {
				// 服务器自重启：等待新进程起来再重连
				await sleep(2000)
				backoff = 500
				continue
			}
			process.exit(code)
		}

		// 异常断开（无 fount_exit）：可能是服务器崩溃或网络抖动，指数退避后重试
		await sleep(backoff)
		backoff = Math.min(backoff * 2, 10000)
	}
}

main().catch(onFatal)
