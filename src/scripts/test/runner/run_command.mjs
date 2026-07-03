import process from 'node:process'

import { execFile } from 'npm:@steve02081504/exec'

import { console, geti18n } from '../../i18n.mjs'
import { ms } from '../../ms.mjs'

/** 无 stdall 输出时终止 suite 的阈值（毫秒）。 */
export const IDLE_TIMEOUT_MS = ms('10m')

/** watchdog 轮询间隔（毫秒）。 */
export const WATCH_INTERVAL_MS = ms('30s')

/** 基于历史耗时的 watchdog 至少给 5 分钟，避免短基线 suite 被误杀。 */
export const MIN_DURATION_TIMEOUT_MS = ms('5m')

/** 历史耗时 watchdog 的倍数阈值。 */
export const DURATION_WATCHDOG_MULTIPLIER = 2

/**
 * @typedef {'idle' | 'duration' | null} WatchdogTrigger
 */

/**
 * @typedef {object} RunCommandOptions
 * @property {string} cwd 工作目录
 * @property {boolean} [stream=false] 是否实时转发 stdout/stderr
 * @property {string} [label] suite 标签（用于终止日志）
 * @property {number} [baselineDurationMs] 上次成功耗时（毫秒）
 */

/**
 * @typedef {object} RunCommandResult
 * @property {number} code 退出码
 * @property {string} output 合并输出
 * @property {boolean} [terminated] 是否被 watchdog 终止
 * @property {string} [terminateReason] 终止原因
 */

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
 * 计算基于历史成功耗时的 duration watchdog 上限。
 * @param {number | undefined} baselineDurationMs 上次成功耗时
 * @returns {number | null} 上限毫秒；无有效 baseline 时返回 null
 */
export function getDurationWatchdogLimitMs(baselineDurationMs) {
	if (baselineDurationMs == null || baselineDurationMs <= 0) return null
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
 * @param {number | undefined} [state.baselineDurationMs] 上次成功耗时
 * @returns {WatchdogTrigger} 触发类型；null 表示继续
 */
export function evaluateWatchdog({ now, startedAt, lastActivityAt, baselineDurationMs }) {
	if (now - lastActivityAt >= IDLE_TIMEOUT_MS) return 'idle'
	const durationLimitMs = getDurationWatchdogLimitMs(baselineDurationMs)
	if (durationLimitMs != null && now - startedAt >= durationLimitMs) return 'duration'
	return null
}

/**
 * 构造 watchdog 终止原因文案。
 * @param {'idle' | 'duration'} trigger 触发类型
 * @param {object} ctx 上下文
 * @param {string} ctx.label suite 标签
 * @param {number} ctx.startedAt 开始时间戳
 * @param {number} ctx.lastActivityAt 上次活动时间戳
 * @param {number} [ctx.baselineDurationMs] 上次成功耗时
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
	const durationLimitMs = getDurationWatchdogLimitMs(baselineDurationMs) ?? 0
	return geti18n('fountConsole.test.terminateDuration', {
		label,
		elapsed: formatMs(elapsedMs),
		baseline: formatMs(baselineDurationMs ?? 0),
		limit: formatMs(durationLimitMs),
	})
}

/**
 * 执行子进程命令并捕获 stdall；含 idle / 2x baseline watchdog。
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
	let capturedOutput = ''
	/** @type {string | null} */
	let terminateReason = null
	let terminated = false

	/**
	 * 刷新活动时间并累积输出。
	 * @param {string | Uint8Array} data 输出片段
	 * @param {((chunk: string | Uint8Array) => void) | undefined} streamFn 转发函数
	 * @returns {void}
	 */
	const append = (data, streamFn) => {
		lastActivityAt = Date.now()
		const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
		capturedOutput += text
		if (streamFn) streamFn(data)
	}

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
		env: { ...process.env, ...extraEnv },
		signal: abortController.signal,
		/**
		 * 转发并记录标准输出。
		 * @param {string | Uint8Array} data 标准输出片段
		 * @returns {void}
		 */
		on_stdout: data => append(data, stream ? process.stdout.write.bind(process.stdout) : undefined),
		/**
		 * 转发并记录标准错误。
		 * @param {string | Uint8Array} data 标准错误片段
		 * @returns {void}
		 */
		on_stderr: data => append(data, stream ? process.stderr.write.bind(process.stderr) : undefined),
	}

	try {
		const result = await execFile(executable, args, execOptions)
		clearInterval(watchdog)
		return { code: result.code ?? 1, output: result.stdall ?? capturedOutput }
	}
	catch (error) {
		clearInterval(watchdog)
		if (terminated || error?.name === 'AbortError') {
			const reason = terminateReason ?? geti18n('fountConsole.test.terminateUnknown', { label })
			const marker = geti18n('fountConsole.test.terminateMarker', { reason })
			const output = `${capturedOutput}${capturedOutput.endsWith('\n') ? '' : '\n'}${marker}\n`
			return { code: 1, output, terminated: true, terminateReason: reason }
		}
		throw error
	}
}
