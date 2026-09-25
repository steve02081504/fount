/** 帖子详情页阅读进度：采集 / 恢复 / 上报（仅长帖，>2/3 屏高）。 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { applyScrollPosition, captureScrollPosition } from '/scripts/features/scrollProgress.mjs'

import { getReadProgress, saveReadProgress, saveReadProgressBeacon } from '../endpoints/readProgress.mjs'

/** 帖子详情卡片内的内容块选择器（含正文顶层块与媒体 / 引用块）。 */
const BLOCK_SELECTOR = '.body.markdown-body > *, .post-media, .quote-block, .reply-context'
/** 滚动停止多久后上报。 */
const SAVE_IDLE_MS = 1200
/** 仅记录渲染高度超过视口此比例的帖子。 */
const MIN_HEIGHT_RATIO = 2 / 3

/** @type {object | null} 当前详情页控制器 */
let active = null

/**
 * 上报指定控制器的当前位置（无内容块可锚定或帖子过短则跳过）。
 * @param {object} controller 控制器
 * @param {{ beacon?: boolean }} [options] beacon：页面隐藏时用 sendBeacon
 * @returns {Promise<void>}
 */
async function persist(controller, { beacon = false } = {}) {
	if (!controller) return
	clearTimeout(controller.timer)
	controller.timer = 0
	const { card } = controller
	if (!(card instanceof HTMLElement) || !card.isConnected) return
	if (card.getBoundingClientRect().height < window.innerHeight * MIN_HEIGHT_RATIO) return
	const captured = captureScrollPosition({ scrollRoot: window, contentRoot: card, blockSelector: BLOCK_SELECTOR })
	if (!captured?.anchor) return
	const progress = [{
		entityHash: controller.entityHash,
		postId: controller.postId,
		anchor: captured.anchor,
		ratio: captured.ratio,
	}]
	if (beacon) {
		await saveReadProgressBeacon(progress)
		return
	}
	await saveReadProgress(progress).catch(handleError('social.readProgress.saveFailed'))
}

/**
 * 绑定帖子详情页的阅读进度采集与恢复；重复绑定会先解绑并 flush 上一帖。
 * @param {{ entityHash: string, postId: string, card: HTMLElement }} options 选项
 * @returns {Promise<void>}
 */
export async function bindPostDetailReadProgress({ entityHash, postId, card }) {
	unbindPostDetailReadProgress()
	if (!(card instanceof HTMLElement) || !entityHash || !postId) return
	/** @type {object} */
	const controller = {
		entityHash,
		postId,
		card,
		timer: 0,
		restoring: true,
		onScroll: null,
		onPageHide: null,
		onVisibility: null,
	}
	active = controller
	try {
		const { progress } = await getReadProgress(entityHash, postId).catch(() => ({}))
		if (active !== controller) return
		if (progress)
			await applyScrollPosition({
				scrollRoot: window,
				contentRoot: card,
				blockSelector: BLOCK_SELECTOR,
				record: progress,
			})
	}
	finally {
		if (active === controller) controller.restoring = false
	}
	if (active !== controller) return

	/** 滚动时防抖保存阅读进度。 */
	controller.onScroll = () => {
		if (active !== controller || controller.restoring) return
		clearTimeout(controller.timer)
		controller.timer = setTimeout(() => { void persist(controller) }, SAVE_IDLE_MS)
	}
	/** 页面隐藏（pagehide）时立即上报进度。 */
	controller.onPageHide = () => { void persist(controller, { beacon: true }) }
	/** 页面转入后台时立即上报进度。 */
	controller.onVisibility = () => {
		if (document.visibilityState === 'hidden') void persist(controller, { beacon: true })
	}
	window.addEventListener('scroll', controller.onScroll, { passive: true })
	window.addEventListener('pagehide', controller.onPageHide)
	document.addEventListener('visibilitychange', controller.onVisibility)
}

/**
 * 解绑当前详情页并 flush 一次进度（切走 / 打开新帖 / 卸载时调用）。
 * @returns {void}
 */
export function unbindPostDetailReadProgress() {
	const controller = active
	if (!controller) return
	active = null
	clearTimeout(controller.timer)
	controller.timer = 0
	if (controller.onScroll) window.removeEventListener('scroll', controller.onScroll)
	if (controller.onPageHide) window.removeEventListener('pagehide', controller.onPageHide)
	if (controller.onVisibility) document.removeEventListener('visibilitychange', controller.onVisibility)
	if (!controller.restoring) void persist(controller)
}
