/**
 * 测试显示输出模式：`human`（TTY 仪表盘）/ `plain`（非 TTY 离散事件）/ `json`（NDJSON）。
 *
 * 背景：非 TTY（agent / 管道 / CI）下旧行为会把内核每次调度抖动逐行打印，出现成片
 * `总剩余：0 个未知时长` / `剩余 0 毫秒` 与内部调度术语，agent 无法一眼抓到重点。
 * `plain` 只发离散、可行动事件；`json` 供工具直接解析。
 */
import process from 'node:process'

import { formatDuration } from '../core/format_duration.mjs'

/** 合法输出模式。 */
export const OUTPUT_MODES = new Set(['human', 'plain', 'json'])

/**
 * 解析输出模式：显式请求 > `FOUNT_TEST_OUTPUT` > 非 TTY 默认 `plain`、TTY 默认 `human`。
 * @param {object} [options] 选项
 * @param {string} [options.requested] 显式请求（CLI `--output` / `--json`）
 * @param {boolean} [options.isTTY] 是否 TTY
 * @param {Record<string, string | undefined>} [options.env] 环境变量
 * @returns {'human' | 'plain' | 'json'} 输出模式
 */
export function resolveOutputMode({ requested, isTTY = Boolean(process.stdout.isTTY), env = process.env } = {}) {
	const candidate = requested || env.FOUNT_TEST_OUTPUT
	if (candidate && OUTPUT_MODES.has(candidate)) return candidate
	// 未知 / 空值：非 TTY 回退 plain，避免静默退回会刷屏的 human 逐行输出。
	return isTTY ? 'human' : 'plain'
}

/**
 * @param {number | null | undefined} ms 毫秒
 * @returns {string} 可读时长
 */
function duration(ms) {
	return ms == null || !Number.isFinite(ms) ? '?' : formatDuration(ms)
}

/**
 * 把一条事件格式化为 plain 行。
 * @param {object} event 事件
 * @returns {string} 单行文本
 */
export function formatPlainEvent(event) {
	switch (event.type) {
		case 'accepted': {
			if (event.error) return `[test] error ${event.error} (exit ${event.code ?? 1})`
			const parts = [
				`selected ${event.goalCount ?? 0}/${event.total ?? 0}`,
				`run ${event.runCount ?? 0}`,
				`reuse ${event.reuseCount ?? 0}`,
				`blocked ${event.blockedCount ?? 0}`,
			]
			if (event.skippedCount) parts.push(`skip ${event.skippedCount}`)
			return `[test] ${parts.join(' · ')}`
		}
		case 'suite-start':
			return `[test] start ${event.key}${event.expectedMs == null ? '' : ` (eta ${duration(event.expectedMs)})`}`
		case 'suite-end':
			if (event.reused) return `[test] reuse ${event.key}`
			if (event.blockedBy?.length) return `[test] blocked ${event.key} (by ${event.blockedBy.join(', ')})`
			return `[test] ${event.passed ? 'ok' : 'fail'} ${event.key} (${duration(event.durationMs)})`
		case 'job-wait':
			return `[test] waiting behind ${event.aheadCount} other job(s)`
		case 'progress':
			return `[test] running ${event.running.join(', ')} (elapsed ${duration(event.elapsedMs)})`
		case 'cleanup-leak':
			return `[test] cleanup leak: ${event.leaks.join(', ')}`
		case 'job-done': {
			const summary = `[test] done exit=${event.exitCode} passed=${event.passed ?? 0} failed=${event.failed ?? 0} (${duration(event.durationMs)})`
			return event.reportPath ? `${summary} · report ${event.reportPath}` : summary
		}
		default:
			return `[test] ${event.type}`
	}
}

/**
 * 创建事件发射器：plain 逐行紧凑文本，json 逐行 NDJSON。
 * @param {'plain' | 'json'} mode 输出模式
 * @param {(line: string) => void} [write] 行写入（默认 stdout）
 * @returns {(event: object) => void} 发射器
 */
export function createEventEmitter(mode, write = line => process.stdout.write(line)) {
	if (mode === 'json')
		return event => write(`${JSON.stringify({ ts: Date.now(), ...event })}\n`)
	return event => write(`${formatPlainEvent(event)}\n`)
}
