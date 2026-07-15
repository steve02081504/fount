/**
 * Feed 停留时长采集（本地隐私信号，不联邦）。
 */

const DWELL_MIN_MS = 3000
const FLUSH_INTERVAL_MS = 30_000
const VISIBLE_RATIO = 0.5

/** @type {{ author: string, postId: string, tags: string[], dwellMs: number, at: number }[]} */
const buffer = []
/** @type {Map<Element, { author: string, postId: string, tags: string[], startedAt: number }>} */
const visible = new Map()
/** @type {IntersectionObserver | null} */
let observer = null
/** @type {ReturnType<typeof setInterval> | null} */
let flushTimer = null
/** @type {((entries: object[]) => void | Promise<void>) | null} */
let flushHandler = null

/**
 * @param {HTMLElement} card 帖卡
 * @returns {{ author: string, postId: string, tags: string[] } | null} 元数据
 */
function cardMeta(card) {
	const author = String(card.dataset.authorEntity || '').trim().toLowerCase()
	const postId = String(card.dataset.postId || '').trim().toLowerCase()
	if (!author || !postId) return null
	const text = (() => {
		try {
			return decodeURIComponent(card.dataset.postText || '')
		}
		catch {
			return card.dataset.postText || ''
		}
	})()
	const tags = [...String(text).matchAll(/#([\p{L}\p{N}_-]{2,32})/gu)].map(match => match[1].toLowerCase())
	return { author, postId, tags }
}

/**
 * @returns {void}
 */
function flushVisibleAges() {
	const now = Date.now()
	for (const [el, state] of visible) {
		const dwellMs = now - state.startedAt
		if (dwellMs >= DWELL_MIN_MS)
			buffer.push({
				author: state.author,
				postId: state.postId,
				tags: state.tags,
				dwellMs,
				at: now,
			})
		state.startedAt = now
		if (!(el instanceof HTMLElement) || !el.isConnected)
			visible.delete(el)
	}
}

/**
 * @returns {Promise<void>}
 */
async function flushBuffer() {
	flushVisibleAges()
	if (!buffer.length || !flushHandler) return
	const batch = buffer.splice(0, buffer.length)
	await flushHandler(batch)
}

/**
 * @param {HTMLElement} root feed 根
 * @param {(entries: object[]) => void | Promise<void>} onFlush 上报回调
 * @returns {() => void} 解绑
 */
export function bindDwellTracker(root, onFlush) {
	unbindDwellTracker()
	if (!(root instanceof HTMLElement)) return () => {}
	flushHandler = onFlush
	observer = new IntersectionObserver(entries => {
		const now = Date.now()
		for (const entry of entries) {
			const el = entry.target
			if (!(el instanceof HTMLElement)) continue
			if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO) {
				if (visible.has(el)) continue
				const meta = cardMeta(el)
				if (!meta) continue
				visible.set(el, { ...meta, startedAt: now })
			}
			else if (visible.has(el)) {
				const state = visible.get(el)
				visible.delete(el)
				const dwellMs = now - state.startedAt
				if (dwellMs >= DWELL_MIN_MS)
					buffer.push({
						author: state.author,
						postId: state.postId,
						tags: state.tags,
						dwellMs,
						at: now,
					})
			}
		}
	}, { threshold: [0, VISIBLE_RATIO, 1] })

	/**
	 * @returns {void}
	 */
	function observeCards() {
		for (const card of root.querySelectorAll('.post-card'))
			observer.observe(card)
	}
	observeCards()
	const mutation = new MutationObserver(() => observeCards())
	mutation.observe(root, { childList: true, subtree: true })

	flushTimer = setInterval(() => {
		void flushBuffer()
	}, FLUSH_INTERVAL_MS)

	/**
	 *
	 */
	const onVisibility = () => {
		if (document.visibilityState === 'hidden')
			void flushBuffer()
	}
	document.addEventListener('visibilitychange', onVisibility)
	window.addEventListener('pagehide', onVisibility)

	return () => {
		mutation.disconnect()
		document.removeEventListener('visibilitychange', onVisibility)
		window.removeEventListener('pagehide', onVisibility)
		unbindDwellTracker()
	}
}

/**
 * @returns {void}
 */
export function unbindDwellTracker() {
	observer?.disconnect()
	observer = null
	if (flushTimer) clearInterval(flushTimer)
	flushTimer = null
	visible.clear()
	flushHandler = null
}

/**
 * @param {object} appContext 应用上下文
 * @param {object[]} entries 停留条目
 * @returns {Promise<void>}
 */
export async function sendDwellBeacon(appContext, entries) {
	if (!entries?.length) return
	const body = JSON.stringify({ entries })
	const url = '/api/parts/shells:social/signals/dwell'
	if (typeof navigator.sendBeacon === 'function') {
		const blob = new Blob([body], { type: 'application/json' })
		if (navigator.sendBeacon(url, blob)) return
	}
	await appContext.socialApi('/signals/dwell', { method: 'POST', body }).catch(() => null)
}
