/**
 * 单一 watch loop：任务轮转，无 backlog，串行防撞车。
 *
 * `run(ctx)` 返回 true = 空转（立刻下一条）；false = 干了事（按 delayMs 再约）。
 * 整轮皆空则停住等 `wake`。`drain()` 先调各任务 `beginDrain`，再跑到全部 `covered`。
 * 未 `start()` 前 `wake` / `drain` 均为 no-op。
 */
import { createReporter } from './reporter.mjs'

/**
 * @typedef {{ draining: boolean }} WatchTickContext
 */

/**
 * @typedef {{
 *   name: string,
 *   delayMs: number,
 *   run: (ctx: WatchTickContext) => boolean | Promise<boolean>,
 *   covered: () => boolean,
 *   beginDrain?: () => void,
 * }} WatchTask
 */

const reporter = createReporter('[test:watch]')

/** @type {WatchTask[]} */
const tasks = []
let cursor = 0
let timer = 0
let running = false
/** 是否已开闸（ES live binding，供门面读取）。 */
export let started = false
let draining = false
let pendingWake = false
let idleStreak = 0
/** @type {(() => void)[]} */
const drainWaiters = []

/**
 * 注册任务。
 * @param {WatchTask} task 任务
 * @returns {void}
 */
export function register(task) {
	tasks.push(task)
}

/**
 * 开闸并启动调度。
 * @returns {void}
 */
export function start() {
	if (started) return
	started = true
	schedule(0)
}

/**
 * 唤醒停住的 loop（或缩短已约的等待）。
 * 任务执行中则记 pending，tick 收尾再排。
 * @returns {void}
 */
export function wake() {
	if (!started) return
	if (running) {
		pendingWake = true
		return
	}
	idleStreak = 0
	schedule(0)
}

/**
 * 测试收尾：通知各任务 beginDrain，再跑到全部 covered。
 * @returns {Promise<void>}
 */
export function drain() {
	if (!started || !tasks.length) return Promise.resolve()
	if (draining)
		return new Promise(resolve => drainWaiters.push(resolve))

	draining = true
	for (const task of tasks) task.beginDrain?.()

	return new Promise(resolve => {
		drainWaiters.push(resolve)
		if (!running) schedule(0)
	})
}

/**
 * 清空调度状态（selftest 用例隔离）。
 * @returns {void}
 */
export function reset() {
	if (timer) clearTimeout(timer)
	timer = 0
	tasks.length = 0
	cursor = 0
	running = false
	started = false
	draining = false
	pendingWake = false
	idleStreak = 0
	for (const resolve of drainWaiters.splice(0)) resolve()
}

/**
 * 各任务覆盖目标是否均已达成。
 * @returns {boolean} 全部 covered 则为 true
 */
function allCovered() {
	return tasks.length > 0 && tasks.every(task => task.covered())
}

/**
 * 若 drain 条件满足则结束并唤醒 waiters。
 * @returns {void}
 */
function resolveDrain() {
	if (!draining || !allCovered() || running || timer) return
	draining = false
	for (const resolve of drainWaiters.splice(0)) resolve()
}

/**
 * @param {number} delayMs 延迟
 * @returns {void}
 */
function schedule(delayMs) {
	if (timer) clearTimeout(timer)
	timer = setTimeout(() => {
		timer = 0
		void tick()
	}, delayMs)
}

/**
 * @returns {Promise<void>}
 */
async function tick() {
	if (!tasks.length || running) return
	if (draining && allCovered()) {
		resolveDrain()
		return
	}

	const task = tasks[cursor % tasks.length]
	cursor++
	running = true
	pendingWake = false
	let idle = false
	try {
		idle = await task.run({ draining }) === true
	}
	catch (error) {
		reporter.report(
			`tick-failed\t${task.name}\t${String(error?.message || error)}`,
			'tick-failed',
			task.name,
			String(error?.message || error),
		)
		idle = false
	}
	finally {
		running = false
	}

	if (pendingWake) {
		pendingWake = false
		idleStreak = 0
		schedule(0)
		return
	}

	if (draining && allCovered()) {
		resolveDrain()
		return
	}

	if (idle) {
		idleStreak++
		if (idleStreak >= tasks.length) {
			idleStreak = 0
			if (draining) {
				if (allCovered()) resolveDrain()
				else schedule(Math.min(...tasks.map(item => item.delayMs)))
				return
			}
			return
		}
		schedule(0)
		return
	}

	idleStreak = 0
	schedule(task.delayMs)
}
