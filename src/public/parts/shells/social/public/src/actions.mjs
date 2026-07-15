import { handleComposerFeedClick } from './actions/composerFeed.mjs'
import { handlePostClick, handleProfileClick } from './actions/postProfile.mjs'
import { handleSavedClick } from './actions/saved.mjs'
import { closePostMoreMenus } from './actions/shared.mjs'

/**
 * 处理主内容区点击：点赞、转发、收藏、关注等交互委托。
 * @param {object} appContext 应用上下文
 * @param {Event} event 点击事件
 * @returns {Promise<void>}
 */
export async function handleMainClick(appContext, event) {
	const { target } = event
	if (!(target instanceof HTMLElement)) return

	const reveal = target.closest('.content-warning-reveal')
	if (reveal instanceof HTMLElement) {
		const wrap = reveal.closest('.content-warning-wrap')
		const body = wrap?.querySelector('.content-warning-body')
		if (body) {
			body.classList.remove('hidden')
			reveal.remove()
		}
		return
	}

	const sensitiveReveal = target.closest('.sensitive-media-reveal')
	if (sensitiveReveal instanceof HTMLElement) {
		const wrap = sensitiveReveal.closest('.sensitive-media-wrap')
		if (wrap instanceof HTMLElement) {
			wrap.dataset.sensitiveCollapsed = '0'
			wrap.classList.add('revealed')
			sensitiveReveal.closest('.sensitive-media-overlay')?.remove()
		}
		return
	}

	if (!target.closest('.post-more-dropdown'))
		closePostMoreMenus()

	await handleComposerFeedClick(appContext, target)
	await handleSavedClick(appContext, target)
	await handleProfileClick(appContext, target)
	if (await handlePostClick(appContext, target)) return
}
