/**
 * 【文件】public/hub/sidebar/createChannel.mjs
 * 【职责】新建频道对话框与入树刷新（可选预选分类）。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { createChannel } from '../../src/endpoints/groupChannel.mjs'
import { getGroupState } from '../../src/endpoints/groupCore.mjs'
import { openDialogFromTemplate, renderTemplateAsHtmlString } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store, setState } from '../core/state.mjs'

import { selectChannel } from './selectChannel.mjs'

/**
 * 弹出新建频道对话框。
 * @param {object} [options] 选项
 * @param {string} [options.category] 预选分类 id
 * @returns {Promise<void>}
 */
export async function showCreateChannelModal(options = {}) {
	const groupId = store.context.currentGroupId
	if (!groupId) return
	await openDialogFromTemplate('channel_create_modal', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: async dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-channel-cancel')?.addEventListener('click', close)
			const categorySelect = dialog.querySelector('#new-channel-category')
			if (categorySelect) {
				const categories = Object.values(store.context.currentState?.categories || {})
				if (categories.length) {
					categorySelect.classList.remove('hidden')
					categorySelect.innerHTML = await renderTemplateAsHtmlString('channel_category_options', {
						categories,
						selectedCategory: options.category || '',
					})
				}
			}
			dialog.querySelector('#new-channel-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-channel-name')?.value?.trim()
				const type = dialog.querySelector('#new-channel-type')?.value || 'text'
				const category = dialog.querySelector('#new-channel-category')?.value || null
				if (!name) return
				try {
					const channelId = await createChannel(groupId, name, type, {
						category: category ? category : null,
					})
					close()
					setState('context.currentState', await getGroupState(groupId))
					const { renderHubChannelSidebar } = await import('./index.mjs')
					await renderHubChannelSidebar(store.context.currentState)
					await selectChannel(channelId)
					showToastI18n('success', 'chat.hub.newChannel.success')
				}
				catch (error) {
					handleError('chat.hub.newChannel.failed')(error)
				}
			})
		},
	})
}
