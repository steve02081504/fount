/**
 * 【文件】public/hub/sidebar/createChannel.mjs
 * 【职责】新建频道对话框与入树刷新。
 */
import { openDialogFromTemplate } from '../../../../../scripts/features/dialog.mjs'
import { usingTemplates } from '../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { createChannel } from '../../src/api/groupChannel.mjs'
import { getGroupState } from '../../src/api/groupCore.mjs'
import { handleUIError } from '../../src/ui/errors.mjs'
import { hubStore, setHubState } from '../core/state.mjs'

import { selectChannel } from './selectChannel.mjs'

/**
 * 弹出新建频道对话框。
 * @returns {Promise<void>}
 */
export async function showCreateChannelModal() {
	const groupId = hubStore.context.currentGroupId
	if (!groupId) return
	usingTemplates('/parts/shells:chat/src/templates')
	await openDialogFromTemplate('channel_create_modal', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-channel-cancel')?.addEventListener('click', close)
			dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-channel-name')?.value?.trim()
				const type = dialog.querySelector('#new-channel-type')?.value || 'text'
				if (!name) return
				try {
					const channelId = await createChannel(groupId, name, type)
					close()
					setHubState('context.currentState', await getGroupState(groupId))
					const { renderHubChannelSidebar } = await import('./index.mjs')
					await renderHubChannelSidebar(hubStore.context.currentState)
					await selectChannel(channelId)
					showToastI18n('success', 'chat.hub.newChannelSuccess')
				}
				catch (error) {
					handleUIError(error, 'chat.hub.newChannelFailed')
				}
			})
		},
	})
}
