/**
 * 测试显示层：连内核 WS，按 1 / 多个 / 0 指定（及 watch）画终端。
 * 不要 import env.mjs（编排器堆快照路径）。
 */
import process from 'node:process'

import { console } from '../../i18n/bare.mjs'
import { SetTaskbarProgress } from '../../taskbar_progress.mjs'
import { formatDuration } from '../core/format_duration.mjs'
import { beginTestProgress, finishTestProgress } from '../core/progress.mjs'
import { testHubUrl } from '../hub/index.mjs'

/**
 * @typedef {object} DisplayOptions
 * @property {boolean} [watch] 是否 watch 挂起
 * @property {object} [job] 提交给内核的 job
 * @property {number} [port] 内核端口
 */

/**
 * 连接内核并显示直到该次调用该退出。
 * @param {DisplayOptions} options 选项
 * @returns {Promise<number>} 退出码
 */
export async function runTestDisplay({ watch = false, job, port } = {}) {
	const url = `${testHubUrl(port).replace(/^http/, 'ws')}/ws/viewer`
	const ws = new WebSocket(url)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', () => reject(new Error(`cannot connect test kernel at ${url}`)), { once: true })
	})

	let exitCode = 0
	let runCount = 0
	let displayMode = watch || !job ? 'overview' : 'multi'
	const done = Promise.withResolvers()
	let finished = 0

	beginTestProgress()

	ws.addEventListener('message', event => {
		const msg = JSON.parse(String(event.data))
		if (msg.type === 'accepted') {
			runCount = msg.runCount ?? 0
			displayMode = msg.mode || displayMode
			if (!watch && runCount === 0 && job) {
				exitCode = msg.code ?? 0
				done.resolve()
			}
			return
		}
		if (msg.type === 'log' && displayMode === 'stream') {
			if (msg.stream === 'stderr') process.stderr.write(msg.chunk ?? '')
			else process.stdout.write(msg.chunk ?? '')
			return
		}
		if (msg.type === 'suite-start') {
			const expected = formatMs(msg.expectedMs)
			const remaining = formatMs(msg.remainingMs)
			const { manifestId, name } = splitKey(msg.key)
			console.logI18n('fountConsole.test.runningSuite.base', { manifestId, name })
			console.logI18n('fountConsole.test.display.eta', { expected, remaining })
			return
		}
		if (msg.type === 'suite-end') {
			finished++
			if (runCount) SetTaskbarProgress(Math.min(100, Math.floor((finished / runCount) * 100)))
			if (msg.skipBecause?.length)
				console.logI18n(msg.passed ? 'fountConsole.test.skipBecause.pass' : 'fountConsole.test.skipBecause.fail', {
					label: msg.key,
					url: (msg.passed ? msg.skipBecause : msg.skipBecauseClosed ?? msg.skipBecause).join(' '),
				})
			else
				console.logI18n(msg.passed ? 'fountConsole.test.passed' : 'fountConsole.test.failed', { label: msg.key })
			if (displayMode !== 'stream')
				console.logI18n('fountConsole.test.display.remaining', { remaining: formatMs(msg.remainingMs) })
			return
		}
		if ((msg.type === 'queue-append' || msg.type === 'queue-remove') && displayMode === 'overview') {
			console.logI18n(
				msg.type === 'queue-append' ? 'fountConsole.test.queue.append' : 'fountConsole.test.queue.remove',
				{ label: msg.key, reason: msg.reason || '', remaining: formatMs(msg.remainingMs) },
			)
			return
		}
		if (msg.type === 'job-done') {
			exitCode = msg.exitCode ?? 0
			if (!watch && displayMode !== 'overview') done.resolve()
			return
		}
		if (msg.type === 'idle' && !watch && displayMode === 'overview')
			done.resolve()
	})

	ws.addEventListener('close', () => done.resolve())
	/** Ctrl+C / kill 时断开 WS。 */
	const onSig = () => {
		ws.close()
		done.resolve()
	}
	process.on('SIGINT', onSig)
	process.on('SIGTERM', onSig)

	ws.send(JSON.stringify({ type: 'hello', watch, job: watch ? undefined : job }))
	await done.promise
	process.off('SIGINT', onSig)
	process.off('SIGTERM', onSig)
	if (ws.readyState === WebSocket.OPEN) ws.close()
	finishTestProgress(exitCode)
	return exitCode
}

/**
 * @param {string} key suite 键
 * @returns {{ manifestId: string, name: string }} 拆分
 */
function splitKey(key) {
	const colon = String(key).indexOf(':')
	if (colon < 0) return { manifestId: key, name: key }
	return { manifestId: key.slice(0, colon), name: key.slice(colon + 1) }
}

/**
 * @param {number | null | undefined} ms 毫秒
 * @returns {string} 可读时长
 */
function formatMs(ms) {
	if (ms == null || !Number.isFinite(ms)) return '?'
	return formatDuration(ms)
}
