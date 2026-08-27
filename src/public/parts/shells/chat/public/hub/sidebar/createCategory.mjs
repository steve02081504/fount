/**
 * 【文件】public/hub/sidebar/createCategory.mjs
 * 【职责】新建频道分类对话框与入树刷新。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { createChannel } from '../../src/endpoints/groupChannel.mjs'
import { openDialogFromTemplate } from '../../src/templates.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { store } from '../core/state.mjs'

import { refreshChannelSidebar } from './createChannel.mjs'

/**
 * 弹出新建分类对话框。
 * @returns {Promise<void>}
 */
export async function showCreateCategoryModal() {
	const groupId = store.context.currentGroupId
	if (!groupId) return
	await openDialogFromTemplate('channel_create_category_modal', {}, {
		activateScripts: false,
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {void}
		 */
		onReady: dialog => {
			/** @returns {void} */
			const close = () => dialog.close()
			dialog.querySelector('#new-category-cancel')?.addEventListener('click', close)
			dialog.querySelector('#new-category-create')?.addEventListener('click', async () => {
				const name = dialog.querySelector('#new-category-name')?.value?.trim()
				if (!name) return
				try {
					await createChannel(groupId, name, 'category')
					close()
					await refreshChannelSidebar()
					showToastI18n('success', 'chat.hub.newCategory.success')
				}
				catch (error) {
					handleError('chat.hub.newCategory.failed')(error)
				}
			})
		},
	})
}
