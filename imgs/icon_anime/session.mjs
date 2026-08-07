/**
 * 图标动画会话：动画状态 + TUI 播放。
 * `signal`：用户 Ctrl+C / 长按 ESC≥4s 中止本会话（sticky）；dismiss 不碰它。
 * 嵌入宿主时应自行拥有进程退出信号，并把本 `signal` 接到那边（见 log_viewer / server index）。
 */
import { setTimeout as delay } from 'node:timers/promises'

import { lightPointer } from './gesture/light.mjs'
import { windPointer } from './gesture/wind.mjs'
import { startGravity, stopGravity } from './gravity.mjs'
import { ICON_W, ICON_H } from './icon.mjs'
import * as player from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/** 用户中止本会话：一旦 abort 保持到进程结束。 */
const userAc = new AbortController()
/** @type {AbortSignal} */
export const signal = userAc.signal

/**
 * 标记用户中止（幂等）。一般由 Ctrl+C / 长按 ESC 触发；宿主也可显式调用。
 * @returns {void}
 */
export function abort() {
	stopGravity()
	userAc.abort()
}

/** @type {ReturnType<typeof createAnimState> | null} */
let state = null
/** @type {Promise<void> | null} */
let running = null

/** @returns {Generator<string, void, unknown>} 入场帧 */
const enterFrames = () => enter(state)
/** @returns {Generator<string, void, unknown>} 保持帧 */
const holdFrames = () => hold(state)
/** @returns {Generator<string, void, unknown>} 退场帧 */
const exitFrames = () => exit(state)

/**
 * 接线 player 回调并进入备用屏。
 * @returns {void}
 */
const openTui = () => {
	startGravity()
	player.start({
		onUserAbort: abort,
		/**
		 * @param {{ columns: number, rows: number }} size 终端尺寸
		 * @returns {void}
		 */
		onResize(size) {
			if (!state || !size.columns || !size.rows) return
			resizeAnimState(state, {
				width: Math.max(ICON_W, size.columns),
				height: Math.max(ICON_H + 1, size.rows - 1),
			})
		},
		/**
		 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} pointerEvent 指针
		 * @returns {void}
		 */
		onPointer(pointerEvent) {
			if (!state) return
			const x = Math.max(0, Math.min(state.width - 1, pointerEvent.x))
			const y = Math.max(0, Math.min(state.height - 1, pointerEvent.y))
			if (pointerEvent.left !== undefined)
				lightPointer(state.light, { x, y, left: pointerEvent.left })
			if (pointerEvent.right !== undefined)
				windPointer(state.wind, { x, y, right: pointerEvent.right })
		},
	})
}

/**
 * 中止当前播放并等其落定。
 * @returns {Promise<void>}
 */
const haltPlay = async () => {
	player.abort()
	await running?.catch(() => { /* abort */ })
	running = null
}

/**
 * 入场 → 保持直至 Ctrl+C / 长按 ESC / dismiss。已在播则直接返回。
 * @returns {Promise<void>}
 */
export async function start() {
	if (running) return running
	state ??= createAnimState()
	openTui()
	return running = player.play(enterFrames).loop(holdFrames)
}

/**
 * 播放入场至完成，随后后台 hold（不退屏）。已在播则直接返回。
 * @returns {Promise<void>}
 */
export async function intro() {
	if (running) return
	state ??= createAnimState()
	openTui()
	await (running = player.play(enterFrames))
	if (signal.aborted) return
	running = player.loop(holdFrames)
}

/**
 * 阻塞至到期或用户中止（均正常兑现）。
 * @param {number} milliseconds 毫秒
 * @returns {Promise<void>}
 */
export async function sleep(milliseconds) {
	try {
		await delay(milliseconds, undefined, { signal })
	}
	catch (error) {
		if (error?.name === 'AbortError') return
		throw error
	}
}

/**
 * 停止保持、离开备用屏；保留状态以待 farewell。
 * @returns {Promise<void>}
 */
export async function dismiss() {
	if (!state) return
	await haltPlay()
	player.stop()
	stopGravity()
}

/**
 * 从存活或停放进度播放退场。
 * @returns {Promise<void>}
 */
export async function farewell() {
	if (!state) return
	if (running) await haltPlay()
	else openTui()
	player.refreshSignal()
	try {
		await player.play(exitFrames)
	}
	finally {
		player.stop()
		stopGravity()
		running = null
		state = null
	}
}
