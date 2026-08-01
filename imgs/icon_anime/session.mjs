/**
 * 图标动画控制器：动画状态 + TUI 播放器。
 * 无进程钩子 — 宿主 await `farewell`（logo CLI）或在关闭时注册（log viewer）。
 */

import { lightPointer } from './gesture/light.mjs'
import { windPointer } from './gesture/wind.mjs'
import { ICON_W, ICON_H } from './icon.mjs'
import { AsciiAnimePlayer } from './player.mjs'
import {
	createAnimState, resizeAnimState, enter, hold, exit,
} from './scene.mjs'

/** 目标帧率。 */
export const fps = 24

/**
 * 图标动画控制器接口。
 * @typedef {object} IconAnime
 * @property {boolean} userAborted - 上次播放因 Ctrl+C 结束（非 dismiss / farewell）
 * @property {AbortSignal} userSignal - userAborted 为 true 时中止
 * @property {() => Promise<void>} start - 入场→保持直至中止 / dismiss（存活期间幂等）
 * @property {() => Promise<void>} intro - 播放入场至完成，停放以待 farewell
 * @property {(milliseconds: number) => Promise<void>} sleep - 等待；用户中止时提前 resolve
 * @property {() => Promise<void>} dismiss - 停止保持、离开备用屏；保留状态以待 farewell
 * @property {() => Promise<void>} farewell - 从存活或停放进度播放退场
 */

/**
 * 创建图标动画控制器（intro / start+dismiss / farewell）。
 * @returns {IconAnime} 控制器
 */
export function createIconAnime() {
	/** @type {AsciiAnimePlayer | null} */
	let player = null
	/** @type {ReturnType<typeof createAnimState> | null} */
	let state = null
	/** @type {Promise<void> | null} */
	let running = null
	/** @type {ReturnType<typeof createAnimState> | null} */
	let parkedState = null
	/** 宿主发起的停止 / farewell 已接管。 */
	let stopping = false
	let userAborted = false
	let userAbortController = new AbortController()

	/** 标记用户 Ctrl+C，并唤醒 await `userSignal` / `sleep` 的宿主。 */
	const markUserAbort = () => {
		userAborted = true
		userAbortController.abort()
	}

	/**
	 * @param {ReturnType<typeof createAnimState>} animState 状态
	 * @returns {AsciiAnimePlayer} 播放器
	 */
	const openPlayer = (animState) => {
		state = animState
		return new AsciiAnimePlayer({
			fps,
			/**
			 * @param {{ columns: number, rows: number }} size 终端尺寸
			 * @returns {void}
			 */
			onResize(size) {
				if (!size.columns || !size.rows) return
				resizeAnimState(animState, {
					width: Math.max(ICON_W, size.columns),
					height: Math.max(ICON_H + 1, size.rows - 1),
				})
			},
			/**
			 * @param {{ x: number, y: number, left?: boolean, right?: boolean }} pointerEvent 指针
			 * @returns {void}
			 */
			onPointer(pointerEvent) {
				const x = Math.max(0, Math.min(animState.width - 1, pointerEvent.x))
				const y = Math.max(0, Math.min(animState.height - 1, pointerEvent.y))
				if (pointerEvent.left !== undefined)
					lightPointer(animState.light, { x, y, left: pointerEvent.left })
				if (pointerEvent.right !== undefined)
					windPointer(animState.wind, { x, y, right: pointerEvent.right })
			},
		})
	}

	/**
	 * 离开备用屏；保留进度以待后续 farewell。
	 * @returns {void}
	 */
	const park = () => {
		parkedState = state
		player?.stop()
		player = null
		state = null
		running = null
	}

	/**
	 * 共享播放关闭：中止 → 微任务 → await running。
	 * 微任务让 play() 的中止处理在 await `running` 前落定。
	 * @returns {Promise<void>}
	 */
	const haltPlay = async () => {
		stopping = true
		player.abort()
		await Promise.resolve()
		await running?.catch(() => { /* abort */ })
		running = null
	}

	return {
		/** @returns {boolean} 上次播放是否因 Ctrl+C 结束 */
		get userAborted() {
			return userAborted
		},

		/** @returns {AbortSignal} userAborted 为 true 时中止 */
		get userSignal() {
			return userAbortController.signal
		},

		/**
		 * 入场 → 保持直至 Ctrl+C / dismiss。
		 * @returns {Promise<void>}
		 */
		start() {
			if (player) return running
			userAborted = false
			stopping = false
			userAbortController = new AbortController()
			player = openPlayer(createAnimState())
			player.start()
			running = player.play(() => enter(state)).loop(() => hold(state)).then(() => {
				if (!stopping) markUserAbort()
			})
			return running
		},

		/**
		 * 播放入场至完成，然后离开备用屏（保留进度以待 farewell）。
		 * @returns {Promise<void>}
		 */
		async intro() {
			if (player) return
			userAborted = false
			stopping = false
			userAbortController = new AbortController()
			player = openPlayer(createAnimState())
			player.start()
			running = Promise.resolve(player.play(() => enter(state)))
			await running
			if (stopping) return
			if (player.signal?.aborted) markUserAbort()
			park()
		},

		/**
		 * @param {number} ms 毫秒
		 * @returns {Promise<void>}
		 */
		sleep(milliseconds) {
			const { signal } = userAbortController
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
		},

		/**
		 * 停止保持、离开备用屏；保留状态以待 farewell。
		 * @returns {Promise<void>}
		 */
		async dismiss() {
			if (!player) return
			await haltPlay()
			park()
		},

		/**
		 * 从存活保持/入场或停放进度播放退场。
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (player) {
				parkedState = null
				await haltPlay()
				await player.play(() => exit(state), { signal: null })
				player.stop()
				player = null
				state = null
				return
			}
			if (!parkedState) return
			player = openPlayer(parkedState)
			parkedState = null
			player.start()
			try {
				await player.play(() => exit(state), { signal: null })
			}
			finally {
				player.stop()
				player = null
				state = null
			}
		},
	}
}
