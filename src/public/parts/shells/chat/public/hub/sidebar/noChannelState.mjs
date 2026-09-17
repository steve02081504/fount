/**
 * 【文件】public/hub/sidebar/noChannelState.mjs
 * 【职责】无可用频道时主区空态：图标 + 文案 +（可管理时）新建频道 CTA。
 * 【原理】showNoChannelMainPane 挂载 hub/empty/no_channel；CTA 按私聊/普通群分别快速新建或弹对话框。
 * 【关联】templates.mjs、categoryContextMenu.canEditChannelList、createChannel.mjs。
 */
import { mountTemplate } from '../../src/templates.mjs'
import { store } from '../core/state.mjs'

/**
 * 在 #messages 挂载「无频道」空态。
 * @param {object} [state] 群 state（缺省使用当前 state）
 * @returns {Promise<void>}
 */
export async function showNoChannelMainPane(state = store.context.currentState) {
	const container = document.getElementById('messages')
	if (!container) return
	const { canEditChannelList } = await import('../categoryContextMenu.mjs')
	const canCreate = !!store.context.currentGroupId && canEditChannelList(state)
	await mountTemplate(container, 'hub/empty/no_channel', { canCreate })
	container.querySelector('#empty-create-channel')?.addEventListener('click', () => void createFirstChannel())
}

/**
 * 空态 CTA：私聊群快速新建，普通群弹出新建频道对话框。
 * @returns {Promise<void>}
 */
async function createFirstChannel() {
	const { isPrivateChatActive } = await import('./privateShell.mjs')
	const { quickCreateChannel, showCreateChannelModal } = await import('./createChannel.mjs')
	if (isPrivateChatActive()) await quickCreateChannel()
	else await showCreateChannelModal()
}
