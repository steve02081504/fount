/**
 * 用户活跃状态检测：记录最后一次交互与焦点状态，并同步给 Service Worker。
 * 用于 SW 判断当前页面是否在 4s 内被用户操作过，从而抑制系统通知。
 */

/** @type {number} 交互事件 throttle 间隔（毫秒） */
const SYNC_THROTTLE_MS = 250

/** @type {number} 最近一次交互时间戳 */
let lastInteractionAt = Date.now()

/** @type {boolean} 当前窗口是否有焦点 */
let hasFocus = document.hasFocus()

/** @type {ReturnType<typeof setTimeout> | null} */
let syncTimer = null

/**
 * 获取当前控制本页的 Service Worker controller。
 * @returns {ServiceWorker | null} controller 或 null
 */
function getController() {
	return navigator.serviceWorker?.controller ?? null
}

/**
 * 向 Service Worker 发送当前活跃状态。
 * @returns {void}
 */
function postActivityToServiceWorker() {
	const controller = getController()
	if (!controller) return
	controller.postMessage({
		type: 'USER_ACTIVITY_UPDATE',
		data: { lastInteractionAt, hasFocus },
	})
}

/**
 * throttle 同步活跃状态。
 * @returns {void}
 */
function scheduleSync() {
	if (syncTimer) return
	syncTimer = setTimeout(() => {
		syncTimer = null
		postActivityToServiceWorker()
	}, SYNC_THROTTLE_MS)
}

/**
 * 记录一次交互并同步给 SW。
 * @returns {void}
 */
function recordInteraction() {
	lastInteractionAt = Date.now()
	scheduleSync()
}

/**
 * 更新焦点状态并同步给 SW。
 * @param {boolean} focused 是否获得焦点
 * @returns {void}
 */
function updateFocus(focused) {
	hasFocus = focused
	scheduleSync()
}

/**
 * 同步的交互事件列表（passive + capture，不影响页面性能）。
 * @type {ReadonlyArray<string>}
 */
const INTERACTION_EVENTS = Object.freeze([
	'pointerdown',
	'keydown',
	'touchstart',
	'wheel',
	'scroll',
])

/**
 * 初始化用户活跃状态监听。
 * 应在 service worker ready 之后调用。
 * @returns {() => void} 清理函数
 */
export function initUserActivityTracking() {
	for (const eventName of INTERACTION_EVENTS)
		window.addEventListener(eventName, recordInteraction, { passive: true, capture: true })

	window.addEventListener('focus', () => updateFocus(true), { capture: true })
	window.addEventListener('blur', () => updateFocus(false), { capture: true })
	document.addEventListener('visibilitychange', () => {
		updateFocus(document.visibilityState === 'visible' && document.hasFocus())
	}, { passive: true })

	// 页面切回前台时立刻更新一次，防止 visibilitychange 与 focus 顺序不确定导致 stale
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			lastInteractionAt = Date.now()
			updateFocus(document.hasFocus())
		}
	}, { passive: true })

	// 立即同步一次初始状态
	postActivityToServiceWorker()

	return () => {
		for (const eventName of INTERACTION_EVENTS)
			window.removeEventListener(eventName, recordInteraction, { passive: true, capture: true })
		window.removeEventListener('focus', () => updateFocus(true), { capture: true })
		window.removeEventListener('blur', () => updateFocus(false), { capture: true })
	}
}

/**
 * 手动强制同步一次当前状态。
 * 用于 SW controller 切换时（如更新后新 SW 接管）。
 * @returns {void}
 */
export function syncUserActivityNow() {
	postActivityToServiceWorker()
}

/**
 * 本地查询当前是否处于用户活跃期（用于 page 自身逻辑）。
 * @param {number} windowMs 时间窗口，默认 4000
 * @returns {boolean} 是否在窗口期内且窗口有焦点
 */
export function isUserRecentlyActive(windowMs = 4000) {
	return hasFocus && Date.now() - lastInteractionAt <= windowMs
}
