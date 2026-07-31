/**
 * log_viewer 等待屏：用 icon_anime 占住终端，服务器就绪后收起，进程退出时播结束动画。
 *
 * 生命周期：
 * - `start()` — 进入 alt-screen，enter → hold
 * - `dismiss()` — 中止 hold、离开 alt-screen（保留 state 供 farewell）
 * - `farewell()` — 从当前/上次进度播 exit；若仍在 alt-screen 则就地播放，否则重新进入
 * - 用户在等待中 Ctrl+C → `userAborted`，打断 `sleep` / `userSignal`，由宿主 `farewell()` 后退出
 */
import { createIconAnimeSession } from '../../imgs/icon_anime/session.mjs'

/**
 * @typedef {object} WaitIcon
 * @property {boolean} userAborted - 等待中被用户 Ctrl+C 中止（非 dismiss）
 * @property {AbortSignal} userSignal - 用户中止时 abort（用于取消 ping）
 * @property {() => void} start - 开始等待动画（已在播则忽略）
 * @property {(ms: number) => Promise<void>} sleep - 可被用户中止打断的等待
 * @property {() => Promise<void>} dismiss - 收起等待动画（不播 exit）
 * @property {() => Promise<void>} farewell - 播放结束动画并恢复终端
 */

/**
 * 创建等待屏控制器（仅交互 TTY 使用）。
 * @param {object} [opts] 选项
 * @param {() => void} [opts.onUserAbort] 用户在等待动画中 Ctrl+C 时回调
 * @returns {WaitIcon} 控制器
 */
export function createWaitIcon({ onUserAbort } = {}) {
	/** @type {ReturnType<typeof createIconAnimeSession> | null} */
	let session = null
	/** @type {Promise<void> | null} */
	let running = null
	/** dismiss / farewell 主动中止时置位，避免记成 userAborted。 */
	let intentionalStop = false
	let userAborted = false
	/** dismiss 后保留，供进程退出时 farewell。 */
	/** @type {ReturnType<typeof createIconAnimeSession>['state'] | null} */
	let farewellState = null
	/** @type {(() => void) | null} 打断 sleep */
	let wakeSleep = null
	let userAc = new AbortController()

	/**
	 * 唤醒正在进行的 sleep（若有）。
	 * @returns {void}
	 */
	const wake = () => {
		wakeSleep?.()
	}

	return {
		/**
		 * @returns {boolean} 是否被用户在等待中中止
		 */
		get userAborted() {
			return userAborted
		},

		/**
		 * @returns {AbortSignal} 用户中止时 abort 的信号
		 */
		get userSignal() {
			return userAc.signal
		},

		/**
		 * @returns {void}
		 */
		start() {
			if (session) return
			userAborted = false
			intentionalStop = false
			userAc = new AbortController()
			session = createIconAnimeSession()
			farewellState = session.state
			session.start()
			running = Promise.resolve(session.run()).then(() => {
				if (intentionalStop) return
				userAborted = true
				userAc.abort()
				wake()
				onUserAbort?.()
			})
		},

		/**
		 * 可被用户中止打断的 sleep（用于 ping 退避）。
		 * @param {number} ms - 毫秒
		 * @returns {Promise<void>}
		 */
		sleep(ms) {
			return new Promise((resolve) => {
				const t = setTimeout(() => {
					wakeSleep = null
					resolve()
				}, ms)
				/**
				 *
				 */
				wakeSleep = () => {
					clearTimeout(t)
					wakeSleep = null
					resolve()
				}
			})
		},

		/**
		 * 服务器就绪：中止 hold，离开 alt-screen，不播 exit。
		 * @returns {Promise<void>}
		 */
		async dismiss() {
			if (!session) return
			intentionalStop = true
			const s = session
			const r = running
			session = null
			running = null
			s.abort()
			await r?.catch(() => { /* abort */ })
			s.stop()
		},

		/**
		 * 进程退出：从当前进度播 exit。
		 * @returns {Promise<void>}
		 */
		async farewell() {
			if (session) {
				intentionalStop = true
				const s = session
				const r = running
				session = null
				running = null
				farewellState = null
				s.abort()
				await r?.catch(() => { /* abort */ })
				await s.playExit()
				s.stop()
				return
			}
			if (!farewellState) return
			const state = farewellState
			farewellState = null
			const s = createIconAnimeSession(state)
			s.start()
			try {
				await s.playExit()
			}
			finally {
				s.stop()
			}
		},
	}
}
