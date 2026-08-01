/**
 * 图标动画会话：动画状态 + TUI 播放。
 * `signal`：用户 Ctrl+C 中止本会话（sticky）；dismiss 不碰它。
 * 嵌入宿主时应自行拥有进程退出信号，并把本 `signal` 接到那边（见 log_viewer）。
 */
import { lightPointer } from './gesture/light.mjs'
import { windPointer } from './gesture/wind.mjs'
import { ICON_W, ICON_H } from './icon.mjs'
import * as player from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/** 目标帧率。 */
export { fps } from './player.mjs'
/** 用户中止本会话：一旦 abort 保持到进程结束。 */
const userAc = new AbortController()
/** @type {AbortSignal} */
export const signal = userAc.signal

/**
 * 标记用户中止（幂等）。一般由 Ctrl+C 触发；宿主也可显式调用。
 * @returns {void}
 */
export function abort() {
	if (!userAc.signal.aborted) userAc.abort()
}

/** @type {ReturnType<typeof createAnimState> | null} */
let state = null
/** @type {Promise<void> | null} */
let running = null
/** TUI 备用屏是否已打开。 */
let open = false

/**
 * 接线 player 回调并进入备用屏。
 * @returns {void}
 */
const openTui = () => {
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
	open = true
}

/**
 * 离开备用屏；保留 `state` 以待 farewell。
 * @returns {void}
 */
const park = () => {
	player.stop()
	open = false
	running = null
}

/**
 * 中止当前播放并等其落定（dismiss / farewell 共用）。
 * @returns {Promise<void>}
 */
const haltPlay = async () => {
	player.abort()
	await Promise.resolve()
	await running?.catch(() => { /* abort */ })
	running = null
}

/**
 * 入场 → 保持直至 Ctrl+C / dismiss。
 * @returns {Promise<void>}
 */
export async function start() {
	if (open) return running
	state = createAnimState()
	openTui()
	await (running = player.play(() => enter(state)).loop(() => hold(state)))
}

/**
 * 播放入场至完成，然后离开备用屏（保留进度以待 farewell）。
 * @returns {Promise<void>}
 */
export async function intro() {
	if (open) return
	state = createAnimState()
	openTui()
	running = player.play(() => enter(state))
	await running
	if (signal.aborted) return
	park()
}

/**
 * @param {number} milliseconds 毫秒
 * @returns {Promise<void>} 到期或用户中止时兑现
 */
export function sleep(milliseconds) {
	if (signal.aborted) return Promise.resolve()
	return new Promise((resolve) => {
		/** 定时器到期或用户中止时唤醒。 */
		const wake = () => {
			clearTimeout(timer)
			signal.removeEventListener('abort', wake)
			resolve()
		}
		const timer = setTimeout(wake, milliseconds)
		signal.addEventListener('abort', wake, { once: true })
	})
}

/**
 * 停止保持、离开备用屏；保留状态以待 farewell。
 * @returns {Promise<void>}
 */
export async function dismiss() {
	if (!open) return
	await haltPlay()
	park()
}

/**
 * 从存活保持/入场或停放进度播放退场。
 * @returns {Promise<void>}
 */
export async function farewell() {
	if (!state) return
	if (open) await haltPlay()
	else openTui()
	player.refreshSignal()
	try {
		await player.play(() => exit(state))
	}
	finally {
		player.stop()
		open = false
		running = null
		state = null
	}
}
