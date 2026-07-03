import { handlePostEngagementClick } from './postEngagementActions.mjs'
import { handlePostProfileActionsClick } from './postProfileActions.mjs'
import { handleProfileNavClick } from './profileNavActions.mjs'

/**
 * 处理个人资料、关注、拉黑与 Tab 切换相关点击。
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<void>}
 */
export async function handleProfileClick(appContext, target) {
	await handleProfileNavClick(appContext, target)
}

/**
 * 处理帖子卡片交互（点赞、转发、回复等）。
 * @param {object} appContext Social 应用上下文
 * @param {HTMLElement} target 点击目标元素
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handlePostClick(appContext, target) {
	if (await handlePostProfileActionsClick(appContext, target)) return true
	return handlePostEngagementClick(appContext, target)
}
