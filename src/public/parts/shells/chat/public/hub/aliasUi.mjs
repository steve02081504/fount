/**
 * 【文件】public/hub/aliasUi.mjs
 * 【职责】别名变更后刷新 Hub 上依赖展示名的界面（消息作者、成员列表、好友列）。
 */
import { hubStore } from './core/state.mjs'

/**
 * 别名缓存已更新后，重绘当前可见的展示名。
 * @returns {Promise<void>}
 */
export async function refreshAliasDependentUi() {
	const messages = document.getElementById('hub-messages')
	if (messages instanceof HTMLElement) {
		const { hydrateAuthorLabels } = await import('./presence.mjs')
		await hydrateAuthorLabels(messages)
	}
	if (hubStore.context.currentState) {
		const { renderMemberList } = await import('./sidebar/index.mjs')
		await renderMemberList(hubStore.context.currentState)
	}
	if (hubStore.context.currentMode === 'friends') {
		const { loadFriendsList, renderFriendsColumn } = await import('./friendsList.mjs')
		await renderFriendsColumn(await loadFriendsList())
	}
}
