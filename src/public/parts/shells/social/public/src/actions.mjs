import { handleComposerFeedClick } from './actions/composerFeed.mjs'
import { handlePostClick, handleProfileClick } from './actions/postProfile.mjs'
import { handleSavedClick } from './actions/saved.mjs'
import { closePostMoreMenus } from './actions/shared.mjs'

/**
 * 处理主内容区点击：点赞、转发、收藏、关注等交互委托。
 * @param {Event} event 点击事件
 * @returns {Promise<void>}
 */
export async function handleMainClick(event) {
	const { target } = event
	if (!(target instanceof HTMLElement)) return

	if (!target.closest('.post-more-dropdown'))
		closePostMoreMenus()

	await handleComposerFeedClick(target)
	await handleSavedClick(target)
	await handleProfileClick(target)
	if (await handlePostClick(target)) return
}
