import { setTimeout, clearTimeout } from 'node:timers'

import { on_shutdown } from 'npm:on-shutdown'

import { ms } from '../scripts/ms.mjs'

/** 在考虑系统空闲之前等待的毫秒数。 */
const IDLE_TIMEOUT_MS = ms('30s')
/** 空闲检查之间的毫秒数。 */
const IDLE_CHECK_INTERVAL_MS = ms('5m')

/** @type {number} */
let lastBusyTime = Date.now()
/** @type {number} */
let runningActions = 0
/** @type {Function[]} */
const idleRuns = []
/** @type {Function[]} */
const idleRunOnces = []
/** @type {ReturnType<typeof setTimeout> | null} */
let timeoutId = null
/** @type {boolean} */
let stopped = true

/**
 * 将系统标记为繁忙。
 * @returns {void}
 */
export function markBusy() {
	lastBusyTime = Date.now()
}

/**
 * 包装并执行一个动作，跟踪其运行状态。
 * @param {Function} action 要执行的异步动作。
 * @returns {Promise<any>} 动作的结果。
 */
export async function runAction(action) {
	runningActions++
	try {
		return await action()
	}
	finally {
		runningActions--
	}
}

/**
 * 将系统标记为繁忙，然后执行一个动作。
 * @param {Function} action 要执行的异步动作。
 * @returns {Promise<any>} 动作的结果。
 */
export async function runBusyAction(action) {
	markBusy()
	return await runAction(action)
}

/**
 * 检查系统当前是否空闲。
 * @returns {boolean} 如果系统空闲则为 true，否则为 false。
 */
export function isIdle() {
	return !runningActions && (Date.now() - lastBusyTime) > IDLE_TIMEOUT_MS
}

/**
 * 注册一个在系统每次变为空闲时执行的动作。
 * @param {Function} action 在空闲时执行的动作。
 * @returns {void}
 */
export function onIdle(action) {
	idleRuns.push(action)
}

/**
 * 取消注册一个在空闲时执行的动作。
 * @param {Function} action 曾通过 onIdle 注册的动作。
 * @returns {void}
 */
export function offIdle(action) {
	const i = idleRuns.indexOf(action)
	if (i !== -1) idleRuns.splice(i, 1)
}

/**
 * 注册一个仅在系统下一次变为空闲时执行的动作。
 * @param {Function} action 在空闲时执行一次的动作。
 * @returns {void}
 */
export function onIdleOnce(action) {
	idleRunOnces.push(action)
	timeoutId?.ref?.()
}

/**
 * 执行所有已注册的空闲动作。
 * @returns {Promise<void>}
 */
async function runIdleTasks() {
	for (const action of idleRuns) try {
		await action()
	} catch (e) {
		console.error('Idle action failed:', e)
	}
	for (const action of idleRunOnces) try {
		await action()
	} catch (e) {
		console.error('Idle action failed:', e)
	}
	timeoutId?.unref?.() // 所有的once动作都执行完了
	idleRunOnces.length = 0
}

on_shutdown(runIdleTasks)

/**
 * 检查空闲状态并运行任务的主循环。
 * @returns {Promise<void>}
 */
async function idleRunner() {
	if (isIdle())
		await runIdleTasks()
}

/**
 * 开始定期检查空闲状态并在空闲时执行已注册任务。
 * @returns {void}
 */
export function startIdleCheck() {
	stopped = false
	timeoutId = setTimeout(async () => {
		timeoutId = null
		await idleRunner()
		if (!stopped) startIdleCheck()
	}, IDLE_CHECK_INTERVAL_MS).unref()
}

/**
 * 停止定期空闲检查。
 * @returns {void}
 */
export function stopIdleCheck() {
	stopped = true
	clearTimeout(timeoutId)
	timeoutId = null
}
