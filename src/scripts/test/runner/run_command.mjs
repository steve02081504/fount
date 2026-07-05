import { Buffer } from 'node:buffer'
import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { console, geti18n } from '../../i18n/bare.mjs'
import { ProcessUsageTracker } from '../core/proc_sample.mjs'
import { ms } from '../../ms.mjs'

/** 无 stdall 输出时终止 suite 的阈值（毫秒）。 */
export const IDLE_TIMEOUT_MS = ms('10m')

/** watchdog 轮询间隔（毫秒）。 */
export const WATCH_INTERVAL_MS = ms('30s')

/** 基于历史耗时的 watchdog 至少给 5 分钟，避免短基线 suite 被误杀。 */
export const MIN_DURATION_TIMEOUT_MS = ms('5m')

/** 无历史基线时的默认最长运行时长。 */
export const DEFAULT_DURATION_TIMEOUT_MS = ms('30m')

/** 历史耗时 watchdog 的倍数阈值。 */
export const DURATION_WATCHDOG_MULTIPLIER = 2

/** 内存中保留的输出尾部上限（字节）。 */
export const OUTPUT_TAIL_BYTES = 2 * 1024 * 1024

/**
 * @typedef {'idle' | 'duration' | null} WatchdogTrigger
 */

/**
 * @typedef {object} RunCommandOptions
 * @property {string} cwd 工作目录
 * @property {boolean} [stream=false] 是否实时转发 stdout/stderr
 * @property {string} [label] suite 标签（用于终止日志）
 * @property {number} [baselineDurationMs] 最近一次可用基线耗时（毫秒）
 */

/**
 * @typedef {object} RunCommandResult
 * @property {number} code 退出码
 * @property {string} output 有界内存尾部（noise 检测与失败落盘）
 * @property {boolean} [terminated] 是否被 watchdog 终止
 * @property {string} [terminateReason] 终止原因
 * @property {number} [peakMemMb] 子进程树峰值内存（MB）
 * @property {number} [avgCpuPct] 子进程树平均 CPU（0–100，归一化后）
 */

/**
 * 有界字符串尾部追加。
 * @param {string} tail 当前尾部
 * @param {string} chunk 新片段
 * @param {number} maxBytes 上限字节
 * @returns {string} 截断后的尾部
 */
export function appendBoundedTail(tail, chunk, maxBytes = OUTPUT_TAIL_BYTES) {
	const merged = tail + chunk
	if (Buffer.byteLength(merged, 'utf8') <= maxBytes) return merged
	let start = merged.length
	while (start > 0 && Buffer.byteLength(merged.slice(start), 'utf8') > maxBytes)
		start -= Math.max(1, Math.floor((Buffer.byteLength(merged, 'utf8') - maxBytes) / 4))
	return merged.slice(start)
}

/**
 * @param {string | Uint8Array} data 输出片段
 * @returns {string} 文本
 */
function decodeChunk(data) {
	return typeof data === 'string' ? data : new TextDecoder().decode(data)
}

/**
 * 格式化毫秒为可读时长（复用 report 文案）。
 * @param {number} ms 毫秒
 * @returns {string} 可读时长
 */
function formatMs(ms) {
	if (ms < 1000) return geti18n('fountConsole.test.report.durationMs', { ms })
	const sec = Math.round(ms / 1000)
	if (sec < 60) return geti18n('fountConsole.test.report.durationSec', { sec })
	const min = Math.floor(sec / 60)
	const rem = sec % 60
	return rem
		? geti18n('fountConsole.test.report.durationMinSec', { min, sec: rem })
		: geti18n('fountConsole.test.report.durationMin', { min })
}

/**
 * 计算基于最近一次可用基线耗时的 duration watchdog 上限。
 * @param {number | undefined} baselineDurationMs 最近一次可用基线耗时
 * @returns {number} 上限毫秒
 */
export function getDurationWatchdogLimitMs(baselineDurationMs) {
	if (baselineDurationMs == null || baselineDurationMs <= 0) return DEFAULT_DURATION_TIMEOUT_MS
	return Math.max(
		MIN_DURATION_TIMEOUT_MS,
		DURATION_WATCHDOG_MULTIPLIER * baselineDurationMs,
	)
}

/**
 * 判定是否应触发 watchdog 终止。
 * @param {object} state 当前状态
 * @param {number} state.now 当前时间戳
 * @param {number} state.startedAt 开始时间戳
 * @param {number} state.lastActivityAt 上次 stdall 活动时间戳
 * @param {number | undefined} [state.baselineDurationMs] 最近一次可用基线耗时
 * @returns {WatchdogTrigger} 触发类型；null 表示继续
 */
export function evaluateWatchdog({ now, startedAt, lastActivityAt, baselineDurationMs }) {
	if (now - lastActivityAt >= IDLE_TIMEOUT_MS) return 'idle'
	const durationLimitMs = getDurationWatchdogLimitMs(baselineDurationMs)
	if (now - startedAt >= durationLimitMs) return 'duration'
	return null
}

/**
 * 构造 watchdog 终止原因文案。
 * @param {'idle' | 'duration'} trigger 触发类型
 * @param {object} ctx 上下文
 * @param {string} ctx.label suite 标签
 * @param {number} ctx.startedAt 开始时间戳
 * @param {number} ctx.lastActivityAt 上次活动时间戳
 * @param {number} [ctx.baselineDurationMs] 最近一次可用基线耗时
 * @param {number} ctx.now 当前时间戳
 * @returns {string} 终止原因
 */
export function buildTerminateReason(trigger, { label, startedAt, lastActivityAt, baselineDurationMs, now }) {
	const elapsedMs = now - startedAt
	if (trigger === 'idle') {
		const idleSec = Math.round((now - lastActivityAt) / 1000)
		return geti18n('fountConsole.test.terminateIdle', {
			label,
			minutes: Math.round(IDLE_TIMEOUT_MS / 60_000),
			idleSec,
			elapsed: formatMs(elapsedMs),
		})
	}
	const durationLimitMs = getDurationWatchdogLimitMs(baselineDurationMs)
	if (baselineDurationMs == null || baselineDurationMs <= 0)
		return geti18n('fountConsole.test.terminateDurationDefault', {
			label,
			elapsed: formatMs(elapsedMs),
			limit: formatMs(durationLimitMs),
		})
	return geti18n('fountConsole.test.terminateDuration', {
		label,
		elapsed: formatMs(elapsedMs),
		baseline: formatMs(baselineDurationMs),
		limit: formatMs(durationLimitMs),
	})
}

/**
 * 执行子进程命令并捕获有界输出；含 idle / duration watchdog。
 * @param {string[]} command 命令
 * @param {Record<string, string>} [extraEnv] 额外环境变量
 * @param {RunCommandOptions} options 执行选项
 * @returns {Promise<RunCommandResult>} 子进程结果
 */
export async function runCommand(command, extraEnv = {}, options) {
	const { stream = false, label = '', baselineDurationMs, cwd } = options
	const [executable, ...args] = command
	const abortController = new AbortController()
	const startedAt = Date.now()
	let lastActivityAt = startedAt
	let outputTail = ''
	const usageTracker = new ProcessUsageTracker()
	let usageSampling = false
	/** @type {string | null} */
	let terminateReason = null
	let terminated = false

	/**
	 * @param {string} text 输出片段
	 * @returns {void}
	 */
	const appendOutput = text => {
		lastActivityAt = Date.now()
		outputTail = appendBoundedTail(outputTail, text)
	}

	const resourceSampler = setInterval(() => {
		if (usageSampling) return
		usageSampling = true
		usageTracker.sample().finally(() => { usageSampling = false })
	}, WATCH_INTERVAL_MS)

	const usageResult = () => usageTracker.finish()

	const watchdog = setInterval(() => {
		if (terminated || abortController.signal.aborted) return
		const trigger = evaluateWatchdog({
			now: Date.now(),
			startedAt,
			lastActivityAt,
			baselineDurationMs,
		})
		if (!trigger) return
		terminateReason = buildTerminateReason(trigger, {
			label,
			startedAt,
			lastActivityAt,
			baselineDurationMs,
			now: Date.now(),
		})
		terminated = true
		console.error(terminateReason)
		abortController.abort()
	}, WATCH_INTERVAL_MS)

	/** @type {import('npm:@steve02081504/exec').ExecOptions & object} */
	const execOptions = {
		cwd,
		// 禁止 stdio:inherit — Deno/Node #35798：coordinator 保留首个 spawn Promise 时第二次 inherit 子进程会使父堆暴涨至 OOM。
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, ...extraEnv },
		signal: abortController.signal,
		no_output_record: true,
		on_spawn: child => usageTracker.setRootFromChild(child),
		/**
		 * @param {string | Uint8Array} data stdout 片段
		 * @returns {void}
		 */
		on_stdout: data => {
			appendOutput(decodeChunk(data))
			if (stream) process.stdout.write(data)
		},
		/**
		 * @param {string | Uint8Array} data stderr 片段
		 * @returns {void}
		 */
		on_stderr: data => {
			appendOutput(decodeChunk(data))
			if (stream) process.stderr.write(data)
		},
	}

	try {
		const result = await execFile(executable, args, execOptions)
		clearInterval(watchdog)
		clearInterval(resourceSampler)
		const { peakMemMb, avgCpuPct } = usageResult()
		return {
			code: result.code ?? 1,
			output: outputTail,
			peakMemMb,
			avgCpuPct,
		}
	}
	catch (error) {
		clearInterval(watchdog)
		clearInterval(resourceSampler)
		if (terminated || error?.name === 'AbortError') {
			const reason = terminateReason ?? geti18n('fountConsole.test.terminateUnknown', { label })
			const marker = geti18n('fountConsole.test.terminateMarker', { reason })
			const output = `${outputTail}${outputTail.endsWith('\n') ? '' : '\n'}${marker}\n`
			const { peakMemMb, avgCpuPct } = usageResult()
			return {
				code: 1,
				output,
				terminated: true,
				terminateReason: reason,
				peakMemMb,
				avgCpuPct,
			}
		}
		throw error
	}
}
