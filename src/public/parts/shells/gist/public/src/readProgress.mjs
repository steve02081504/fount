/** gist 文档查看页阅读进度：采集 / 恢复 / 上报（每个 gist 独立）。 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { applyScrollPosition, captureScrollPosition } from '/scripts/features/scrollProgress.mjs'

import { getReadProgress, saveReadProgress, saveReadProgressBeacon } from './endpoints.mjs'

/** 滚动停止多久后上报。 */
const SAVE_IDLE_MS = 1200

/** @type {object | null} 当前查看页控制器 */
let active = null

/**
 * 上报指定控制器的当前位置（内容不可滚动则跳过）。
 * @param {object} controller 控制器
 * @param {{ beacon?: boolean }} [options] beacon：页面隐藏时用 sendBeacon
 * @returns {Promise<void>}
 */
async function persist(controller, { beacon = false } = {}) {
	if (!controller) return
	clearTimeout(controller.timer)
	controller.timer = 0
	const { scrollRoot, contentRoot } = controller
	if (!(scrollRoot instanceof HTMLElement) || !(contentRoot instanceof HTMLElement)) return
	if (scrollRoot.scrollHeight <= scrollRoot.clientHeight + 4) return
	const captured = captureScrollPosition({ scrollRoot, contentRoot })
	if (!captured?.anchor) return
	const progress = [{ id: controller.id, anchor: captured.anchor, ratio: captured.ratio }]
	if (beacon) {
		await saveReadProgressBeacon(progress)
		return
	}
	await saveReadProgress(progress).catch(handleError('gist.error.generic'))
}

/**
 * 绑定 gist 查看页阅读进度：先在无 URL hash 时恢复，再跟踪滚动上报；重复绑定会先解绑。
 * @param {{ id: string, scrollRoot: HTMLElement | null, contentRoot: HTMLElement | null }} options 选项
 * @returns {Promise<void>}
 */
export async function bindGistReadProgress({ id, scrollRoot, contentRoot }) {
	unbindGistReadProgress()
	if (!id || !(scrollRoot instanceof HTMLElement) || !(contentRoot instanceof HTMLElement)) return
	/** @type {object} */
	const controller = {
		id,
		scrollRoot,
		contentRoot,
		timer: 0,
		restoring: true,
		onScroll: null,
		onPageHide: null,
		onVisibility: null,
	}
	active = controller
	try {
		const { progress } = await getReadProgress(id).catch(() => ({}))
		if (active !== controller) return
		if (progress && !location.hash)
			await applyScrollPosition({ scrollRoot, contentRoot, record: progress })
	}
	finally {
		if (active === controller) controller.restoring = false
	}
	if (active !== controller) return

	/**
	 *
	 */
	controller.onScroll = () => {
		if (active !== controller || controller.restoring) return
		clearTimeout(controller.timer)
		controller.timer = setTimeout(() => { void persist(controller) }, SAVE_IDLE_MS)
	}
	/**
	 *
	 */
	controller.onPageHide = () => { void persist(controller, { beacon: true }) }
	/**
	 *
	 */
	controller.onVisibility = () => {
		if (document.visibilityState === 'hidden') void persist(controller, { beacon: true })
	}
	scrollRoot.addEventListener('scroll', controller.onScroll, { passive: true })
	window.addEventListener('pagehide', controller.onPageHide)
	document.addEventListener('visibilitychange', controller.onVisibility)
}

/**
 * 解绑当前查看页并 flush 一次进度。
 * @returns {void}
 */
export function unbindGistReadProgress() {
	const controller = active
	if (!controller) return
	active = null
	clearTimeout(controller.timer)
	controller.timer = 0
	if (controller.onScroll && controller.scrollRoot instanceof HTMLElement)
		controller.scrollRoot.removeEventListener('scroll', controller.onScroll)
	if (controller.onPageHide) window.removeEventListener('pagehide', controller.onPageHide)
	if (controller.onVisibility) document.removeEventListener('visibilitychange', controller.onVisibility)
	if (!controller.restoring) void persist(controller)
}
