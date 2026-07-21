import { handleComposerFeedClick } from './actions/composerFeed.mjs'
import { handleDraftsClick } from './actions/drafts.mjs'
import { handlePostEngagementClick } from './actions/postEngagementActions.mjs'
import { handlePostProfileActionsClick } from './actions/postProfileActions.mjs'
import { handleProfileNavClick } from './actions/profileNavActions.mjs'
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
	if (await handleDraftsClick(target)) return
	await handleSavedClick(target)
	await handleProfileNavClick(target)
	if (await handlePostProfileActionsClick(target)) return
	await handlePostEngagementClick(target)
}
